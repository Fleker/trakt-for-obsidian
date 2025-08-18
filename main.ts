import * as obsidian from 'obsidian';
// moment.js is included with Obsidian, so we can use it for flexible date formatting.
const moment = window.moment; 

// Define an interface for the plugin settings for type safety
interface TraktPluginSettings {
    apiKey: string;
    secretKey: string;
    refresh?: string;
    ignoreBefore: string;
    dateFormat: string;
}

// Define an interface for the token data structure
interface TraktToken {
    access_token: string;
    refresh_token: string;
    expires: number;
}

const DEFAULT_SETTINGS: TraktPluginSettings = {
    apiKey: "",
    secretKey: "",
    refresh: undefined,
    ignoreBefore: "1970.01.01",
    dateFormat: "YYYY.MM.DD",
};

// This helper function now uses the user-defined format from settings
function dateToJournal(date: Date, format: string): string {
    return moment(date).format(format);
}

export default class TraktPlugin extends obsidian.Plugin {
    settings: TraktPluginSettings;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: "sync",
            name: "Sync watched history",
            callback: () => this.syncHistory(),
        });
        
        this.addSettingTab(new TraktSettingTab(this.app, this));

        this.registerObsidianProtocolHandler("trakt", async (params) => {
            const { code } = params;
            if (!code) { new obsidian.Notice("Trakt authentication code not found."); return; }

            try {
                const response = await obsidian.requestUrl({
                    method: 'POST',
                    url: 'https://api.trakt.tv/oauth/token',
                    contentType: 'application/json',
                    body: JSON.stringify({
                        code: code,
                        client_id: this.settings.apiKey,
                        client_secret: this.settings.secretKey,
                        redirect_uri: "obsidian://trakt",
                        grant_type: "authorization_code"
                    })
                });
                const tokens = response.json;
                const tokenData: TraktToken = {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires: Date.now() + (tokens.expires_in * 1000),
                };
                this.settings.refresh = JSON.stringify(tokenData);
                await this.saveSettings();
                new obsidian.Notice("Successfully connected to Trakt account!");
            } catch (e) {
                console.error("Trakt token exchange error:", e);
                new obsidian.Notice("Error getting Trakt token.");
            }
        });
    }
    
    async syncHistory() {
        if (!this.settings.apiKey || !this.settings.secretKey) {
            new obsidian.Notice("Please enter Trakt API and Secret keys in settings.");
            return;
        }
        if (!this.settings.refresh) {
            new obsidian.Notice("You are not connected to a Trakt account. Please connect in settings.");
            return;
        }
    
        let token: TraktToken;
        try {
            token = JSON.parse(this.settings.refresh);
            if (token.expires < Date.now()) {
                new obsidian.Notice("Trakt token expired, refreshing...");
                const refreshResponse = await obsidian.requestUrl({
                    method: 'POST',
                    url: 'https://api.trakt.tv/oauth/token',
                    contentType: 'application/json',
                    body: JSON.stringify({
                        refresh_token: token.refresh_token,
                        client_id: this.settings.apiKey,
                        client_secret: this.settings.secretKey,
                        redirect_uri: "obsidian://trakt",
                        grant_type: "refresh_token"
                    })
                });
                const newTokens = refreshResponse.json;
                token = {
                    access_token: newTokens.access_token,
                    refresh_token: newTokens.refresh_token,
                    expires: Date.now() + (newTokens.expires_in * 1000),
                };
                this.settings.refresh = JSON.stringify(token);
                await this.saveSettings();
            }
        } catch (e) {
            console.error("Trakt token refresh error:", e);
            new obsidian.Notice("Trakt authentication error! Please reconnect in settings.");
            return;
        }
    
        try {
            new obsidian.Notice("Syncing Trakt history...");
            const apiHeaders = {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': this.settings.apiKey,
                'Authorization': `Bearer ${token.access_token}`
            };

            const [ratingsResponse, watchedShowsResponse, watchedMoviesResponse] = await Promise.all([
                obsidian.requestUrl({ method: 'GET', url: 'https://api.trakt.tv/sync/ratings/all', headers: apiHeaders }),
                obsidian.requestUrl({ method: 'GET', url: 'https://api.trakt.tv/sync/watched/shows?extended=full', headers: apiHeaders }),
                obsidian.requestUrl({ method: 'GET', url: 'https://api.trakt.tv/sync/watched/movies?extended=full', headers: apiHeaders })
            ]);

            const ratingsHistory = ratingsResponse.json;
            const watchedShowsHistory = watchedShowsResponse.json;
            const watchedMoviesHistory = watchedMoviesResponse.json;

            const showsData: any = {};
            const moviesData: any = {};
            const ignoreDate = new Date(this.settings.ignoreBefore.replace(/\./g, '-'));

            // Process watched shows
            for (const show of watchedShowsHistory) {
                if (!show.seasons) continue;
                for (const season of show.seasons) {
                    if (!season.episodes) continue;
                    for (const episode of season.episodes) {
                        const watchDate = new Date(episode.last_watched_at);
                        if (watchDate < ignoreDate) continue;

                        const showTitle = show.show.title;
                        if (!showsData[showTitle]) {
                            showsData[showTitle] = {
                                link: `https://trakt.tv/shows/${show.show.ids.slug}`,
                                episodes: {}
                            };
                        }
                        const episodeId = `S${String(season.number).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`;
                        showsData[showTitle].episodes[episodeId] = {
                            date: dateToJournal(watchDate, this.settings.dateFormat),
                            plays: episode.plays,
                            rating: null
                        };
                    }
                }
            }
            
            // Process watched movies
            for (const movie of watchedMoviesHistory) {
                const watchDate = new Date(movie.last_watched_at);
                if(watchDate < ignoreDate) continue;

                const movieTitle = movie.movie.title;
                if(!moviesData[movieTitle]) {
                    moviesData[movieTitle] = {
                        link: `https://trakt.tv/movies/${movie.movie.ids.slug}`,
                        events: []
                    };
                }
                moviesData[movieTitle].events.push({
                    date: dateToJournal(watchDate, this.settings.dateFormat),
                    plays: movie.plays,
                    type: 'watch',
                    rating: null
                });
            }

            // Process ratings and merge with existing data
            for (const item of ratingsHistory) {
                const ratedDate = new Date(item.rated_at);
                if (ratedDate < ignoreDate) continue;
                
                if (item.type === 'episode') {
                    const showTitle = item.show.title;
                    if (!showsData[showTitle]) {
                         showsData[showTitle] = {
                            link: `https://trakt.tv/shows/${item.show.ids.slug}`,
                            episodes: {}
                        };
                    }
                    const episodeId = `S${String(item.episode.season).padStart(2, '0')}E${String(item.episode.number).padStart(2, '0')}`;
                    if(showsData[showTitle].episodes[episodeId]) {
                        showsData[showTitle].episodes[episodeId].rating = item.rating;
                    } else {
                        showsData[showTitle].episodes[episodeId] = {
                            date: dateToJournal(ratedDate, this.settings.dateFormat),
                            plays: null,
                            rating: item.rating
                        };
                    }
                } else if (item.type === 'movie') {
                    const movieTitle = item.movie.title;
                    if (!moviesData[movieTitle]) {
                        moviesData[movieTitle] = {
                            link: `https://trakt.tv/movies/${item.movie.ids.slug}`,
                            events: []
                        };
                    }
                    moviesData[movieTitle].events.push({
                        date: dateToJournal(ratedDate, this.settings.dateFormat),
                        plays: null,
                        type: 'rating',
                        rating: item.rating
                    });
                }
            }

            // Generate Markdown content
            let markdownContent = "";

            // Shows section
            const sortedShowTitles = Object.keys(showsData).sort((a, b) => a.localeCompare(b));
            if(sortedShowTitles.length > 0) {
                markdownContent += "# Shows\n\n";
                for (const title of sortedShowTitles) {
                    const show = showsData[title];
                    markdownContent += `## [${title}](${show.link})\n`;
                    const sortedEpisodes = Object.keys(show.episodes).sort();
                    for(const episodeId of sortedEpisodes) {
                        const ep = show.episodes[episodeId];
                        let line = `- ${episodeId}`;
                        if(ep.rating) {
                            line += ` (Rated: ${ep.rating}/10)`;
                        }
                        line += ` on [[${ep.date}]]\n`;
                        markdownContent += line;
                    }
                    markdownContent += "\n";
                }
            }

            // Movies section
            const sortedMovieTitles = Object.keys(moviesData).sort((a, b) => a.localeCompare(b));
            if(sortedMovieTitles.length > 0) {
                 markdownContent += "# Movies\n\n";
                 for(const title of sortedMovieTitles) {
                     const movie = moviesData[title];
                     markdownContent += `## [${title}](${movie.link})\n`;
                     
                     const eventsByDate: any = {};
                     for(const event of movie.events) {
                         if(!eventsByDate[event.date]) eventsByDate[event.date] = {};
                         if(event.type === 'watch') eventsByDate[event.date].plays = event.plays;
                         if(event.type === 'rating') eventsByDate[event.date].rating = event.rating;
                     }

                     for(const date in eventsByDate) {
                         const event = eventsByDate[date];
                         let line = `- `;
                         if(event.plays) {
                             line += `Watch #${event.plays}`;
                             if(event.rating) line += `, Rated: ${event.rating}/10`;
                         } else if(event.rating) {
                              line += `Rated: ${event.rating}/10`;
                         }
                         line += ` on [[${date}]]\n`;
                         markdownContent += line;
                     }
                     markdownContent += "\n";
                 }
            }

            // Create or overwrite the file
            const filename = obsidian.normalizePath("/Trakt History.md");
            const file = this.app.vault.getFileByPath(filename);
            if (!file) {
                await this.app.vault.create(filename, markdownContent.trim());
            } else {
                await this.app.vault.modify(file, markdownContent.trim());
            }
    
            new obsidian.Notice("Trakt history successfully synced!");
    
        } catch (error) {
            console.error('Trakt API request failed:', error);
            new obsidian.Notice('Trakt API request failed. Check the console for details.');
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class TraktSettingTab extends obsidian.PluginSettingTab {
    plugin: TraktPlugin;

    constructor(app: obsidian.App, plugin: TraktPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Trakt.tv Sync Settings' });

        new obsidian.Setting(containerEl)
            .setName("Trakt Client ID")
            .setDesc("Your Trakt application's Client ID (API Key).")
            .addText((text) => text.setPlaceholder("Enter your Client ID").setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => { this.plugin.settings.apiKey = value; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl)
            .setName("Trakt Client Secret")
            .setDesc("Your Trakt application's Client Secret.")
            .addText((text) => text.setPlaceholder("Enter your Client Secret").setValue(this.plugin.settings.secretKey)
                .onChange(async (value) => { this.plugin.settings.secretKey = value; await this.plugin.saveSettings(); }));

        if (this.plugin.settings.refresh) {
            new obsidian.Setting(containerEl).setName("Connection Status").setDesc("Successfully connected to your Trakt account.")
                .addButton((button) => button.setButtonText("Disconnect").setWarning()
                    .onClick(async () => {
                        this.plugin.settings.refresh = undefined;
                        await this.plugin.saveSettings();
                        new obsidian.Notice("Disconnected from Trakt.");
                        this.display();
                    }));
        } else {
            new obsidian.Setting(containerEl).setName("Connect to Trakt").setDesc("After saving your keys, click here to connect your Trakt account.")
                .addButton((button) => button.setButtonText("Connect").setCta()
                    .onClick(() => {
                        if (!this.plugin.settings.apiKey) { new obsidian.Notice("Please enter a Client ID first."); return; }
                        const authUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${this.plugin.settings.apiKey}&redirect_uri=obsidian://trakt`;
                        window.open(authUrl);
                    }));
        }
        
        new obsidian.Setting(containerEl)
            .setName("Date Format")
            .setDesc("The date format to use in the generated file. Uses Moment.js tokens. (e.g., YYYY-MM-DD, DD/MM/YYYY)")
            .addText((text) => text.setPlaceholder("YYYY.MM.DD").setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                })
            );

        new obsidian.Setting(containerEl)
            .setName("Ignore entries before")
            .setDesc("Events recorded before this date will not be synced. (Format: YYYY.MM.DD)")
            .addText((text) => text.setPlaceholder("1970.01.01").setValue(this.plugin.settings.ignoreBefore)
                .onChange(async (value) => {
                    if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(value)) {
                        this.plugin.settings.ignoreBefore = value.replace(/-/g, '.').replace(/\//g, '.');
                        await this.plugin.saveSettings();
                    }
                }));
    }
}