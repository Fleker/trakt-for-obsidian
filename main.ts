import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';
import Trakt from 'trakt.tv'

/**
{
    "plays": 142,
    "last_watched_at": "2024-09-17T04:38:29.000Z",
    "last_updated_at": "2024-09-17T04:38:28.000Z",
    "reset_at": null,
    "show": {
        "title": "Futurama",
        "year": 1999,
        "ids": {
            "trakt": 614,
            "slug": "futurama",
            "tvdb": 73871,
            "imdb": "tt0149460",
            "tmdb": 615,
            "tvrage": null
        }
    },
    "seasons": [
        // ...,
        {
            "number": 9,
            "episodes": [
                {
                    "number": 1,
                    "plays": 1,
                    "last_watched_at": "2024-08-08T02:43:20.000Z"
                },
                {
                    "number": 2,
                    "plays": 1,
                    "last_watched_at": "2024-08-08T03:13:33.000Z"
                },
								// ...
            ]
        }
    ]
}
 */

interface ShowIds {
	trakt: number
	slug: string
	tvdb: number
	imdb: string
	tmdb: number
	tvrage: unknown
}

interface TraktWatchedShow {
	/** Total episodes of the show played, can be repeated */
	plays: number
	/** Date-String */
	last_watched_at: string
	/** Date-String */
	last_updated_at: string
	show: {
		title: string
		/** Year show premiered */
		year: number
		ids: ShowIds
	}
	seasons: {
		number: number
		episodes: {
			number: number
			plays: number
			/** Date-string */
			last_watched_at: string
		}[]
	}[]
}

interface TraktCheckedInEpisode {
	/** Date-string */
	rated_at: string
	rating: number
	type: 'episode' | string
	episode ?: {
		season: number
		number: number
		title: string
		ids: ShowIds
	}
	show ?: {
		title: string
		year: number
		ids: ShowIds
	}
}

interface TraktWatchedMovie {
    plays: number;
    last_watched_at: string;
    movie: {
        title: string;
        year: number;
        ids: MovieIds;
    };
}


interface ShowIds {
    trakt: number;
    slug: string;
    tvdb: number;
    imdb: string;
    tmdb: number;
    tvrage: unknown;
}

interface MovieIds extends ShowIds {}

interface TraktRating {
    rated_at: string;
    rating: number;
    type: 'movie' | 'episode' | 'show' | 'season';
    movie?: { ids: MovieIds };
    episode?: { ids: ShowIds };
    show?: { ids: ShowIds };
    season?: { number: number }; // In a season rating, the show object is at the top level
}

interface TraktSettings {
	apiKey?: string;
	secretKey?: string;
	// Refresh Token
	refresh?: string;
	ignoreBefore: string;
}

// Interfaces for our processed, structured data
interface ProcessedEpisode {
    number: number;
    watched_at: string;
    rating: number | null;
}

interface ProcessedSeason {
    number: number;
    rating: number | null;
    episodes: ProcessedEpisode[];
}

interface ProcessedShow {
    title: string;
    slug: string;
    rating: number | null;
    posterUrl: string;
    seasons: ProcessedSeason[];
}

interface ProcessedMovie {
    title: string;
    year: number;
    slug: string;
    posterUrl: string;
    watched_at: string;
    rating: number | null;
}

const DEFAULT_SETTINGS: TraktSettings = {
	refresh: undefined,
	ignoreBefore: '1970-01-01',
}

function dateToJournal(date: Date) {
	return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

function formatRating(rating: number | null): string {
    if (rating === null || rating === undefined) {
        return '–';
    }
    return `${rating}★`;
}

export default class TraktPlugin extends Plugin {
	settings: TraktSettings;
	trakt: any;
	private posterCache = new Map<number, string>();
	// Cache for season details to get episode Trakt IDs
	private seasonDetailsCache = new Map<string, Map<string, number>>();

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'sync',
			name: 'Sync watched history',
			callback: async () => {
				if (!this.settings.apiKey || !this.settings.secretKey) {
					return new Notice('Missing Trakt application keys')
				}
				this.trakt = new Trakt({
					client_id: this.settings.apiKey,
					client_secret: this.settings.secretKey,
					redirect_uri: 'obsidian://trakt',
					debug: true,
				})
				if (!this.settings.refresh) {
					new Notice('Cannot get authorization')
				}
				const ignore = new Date(this.settings.ignoreBefore)
				// const newToken = await this.trakt.import_token(JSON.parse(this.settings.refresh!))
				// this.settings.refresh = JSON.stringify(newToken)
				// this.saveSettings(this.settings)
				// try {
				// 	await this.trakt.refresh_token()
				// } catch (e) {
				// 	new Notice('Authentication error, reauthorization required')
				// }

				if (!this.settings.apiKey || !this.settings.secretKey) {
            return new Notice('Missing Trakt application keys');
        }
        if (!this.settings.refresh) {
            return new Notice('Not authenticated with Trakt. Please connect your account in settings.');
        }

        new Notice('Syncing with Trakt... This may take a moment.');
        this.posterCache.clear();
        this.seasonDetailsCache.clear();

        try {
            // 1. Authenticate
            await this.trakt.import_token(JSON.parse(this.settings.refresh!));
            const newToken = await this.trakt.refresh_token();
            this.settings.refresh = JSON.stringify(newToken);
            await this.saveSettings(this.settings);

            // 2. Fetch all necessary data
            const ignoreDate = new Date(this.settings.ignoreBefore);
            const [watchedShows, watchedMovies, allRatings] = await Promise.all([
                this.trakt.sync.watched({ type: 'shows' }) as Promise<TraktWatchedShow[]>,
                this.trakt.sync.watched({ type: 'movies' }) as Promise<TraktWatchedMovie[]>,
                this.trakt.sync.ratings.get({ type: 'all' }) as Promise<TraktRating[]>,
            ]);

            // 3. Process and structure the data
            const ratingsMap = this.createRatingsMap(allRatings);
            
            const processedShows = await this.processShowData(watchedShows, ratingsMap, ignoreDate);
            const processedMovies = await this.processMovieData(watchedMovies, ratingsMap, ignoreDate);

            // 4. Generate Markdown content
            const tvShowMarkdown = this.generateTvShowMarkdown(processedShows);
            const movieMarkdown = this.generateMovieMarkdown(processedMovies);
            const finalMarkdown = `${tvShowMarkdown}\n\n---\n\n${movieMarkdown}`;

            // 5. Write to file
            await this.writeFile('Trakt Watch Log.md', finalMarkdown);
            new Notice('Trakt history sync complete!');

        } catch (e) {
            console.error('Trakt Sync Error:', e);
            new Notice('Authentication error, reauthorization may be required.');
        }
			},
		})

		this.addSettingTab(new TraktSettingTab(this.app, this));

		this.registerObsidianProtocolHandler('trakt', async (data) => {
			const {code, state} = data
			await this.trakt.exchange_code(code, state)
			this.settings.refresh = JSON.stringify(this.trakt.export_token())
			await this.saveSettings(this.settings)
			new Notice('You are now connected to Trakt')
		})

		if (this.settings.apiKey === undefined) {
			return new Notice('Trakt.tv plugin needs API key')
		}
	}

	/**
     * Creates a Map for quick rating lookups using composite keys.
     */
    createRatingsMap(ratings: TraktRating[]): Map<string, { rating: number; rated_at: string }> {
        const map = new Map<string, { rating: number; rated_at: string }>();
        for (const item of ratings) {
            let key: string | null = null;
            switch (item.type) {
                case 'movie':
                    if (item.movie?.ids?.trakt) key = `movie-${item.movie.ids.trakt}`;
                    break;
                case 'show':
                    if (item.show?.ids?.trakt) key = `show-${item.show.ids.trakt}`;
                    break;
                case 'season':
                    if (item.show?.ids?.trakt && item.season?.number !== undefined) {
                        key = `season-${item.show.ids.trakt}-${item.season.number}`;
                    }
                    break;
                case 'episode':
                    if (item.episode?.ids?.trakt) key = `episode-${item.episode.ids.trakt}`;
                    break;
            }
            if (key) {
                map.set(key, { rating: item.rating, rated_at: item.rated_at });
            }
        }
        return map;
    }

    async getPosterUrl(type: 'show' | 'movie', id: number): Promise<string> {
        if (this.posterCache.has(id)) {
            return this.posterCache.get(id)!;
        }
        try {
            const summary = type === 'show'
                ? await this.trakt.shows.summary({ id, extended: 'images' })
                : await this.trakt.movies.summary({ id, extended: 'images' });
            console.log('getposterurl', summary)
            const posterPath = `https://${summary.images?.poster?.[0]}`;
            const posterUrl = posterPath ? posterPath : "https://placehold.co/150x225/1F2937/FFFFFF?text=No+Poster";
            this.posterCache.set(id, posterUrl);
            return posterUrl;
        } catch (error) {
            console.warn(`Could not fetch poster for ${type} ID ${id}`, error);
            return "https://placehold.co/150x225/1F2937/FFFFFF?text=Error";
        }
    }

    /**
     * Fetches full season details for a show to map episodes to their Trakt IDs.
     */
    async getEpisodeIdMapForShow(showSlug: string): Promise<Map<string, number>> {
        if (this.seasonDetailsCache.has(showSlug)) {
            return this.seasonDetailsCache.get(showSlug)!;
        }
        try {
            const seasonsData = await this.trakt.seasons.summary({ id: showSlug, extended: 'episodes' });
            const idMap = new Map<string, number>();
            for (const season of seasonsData) {
                for (const episode of season.episodes) {
                    const key = `S${season.number}E${episode.number}`;
                    idMap.set(key, episode.ids.trakt);
                }
            }
            this.seasonDetailsCache.set(showSlug, idMap);
            return idMap;
        } catch (error) {
            console.warn(`Could not fetch season details for show ${showSlug}`, error);
            return new Map<string, number>(); // Return empty map on error
        }
    }

    async processShowData(shows: TraktWatchedShow[], ratingsMap: Map<string, any>, ignoreDate: Date): Promise<ProcessedShow[]> {
        const processedShows: ProcessedShow[] = [];
        for (const show of shows) {
            const showRatingInfo = ratingsMap.get(`show-${show.show.ids.trakt}`);
            const episodeIdMap = await this.getEpisodeIdMapForShow(show.show.ids.slug);
            const posterUrl = await this.getPosterUrl('show', show.show.ids.trakt);
            
            const processed: ProcessedShow = {
                title: show.show.title,
                slug: show.show.ids.slug,
                posterUrl,
                rating: showRatingInfo ? showRatingInfo.rating : null,
                seasons: [],
            };

            for (const season of show.seasons) {
                const seasonRatingInfo = ratingsMap.get(`season-${show.show.ids.trakt}-${season.number}`);
                const processedSeason: ProcessedSeason = { 
                    number: season.number, 
                    rating: seasonRatingInfo ? seasonRatingInfo.rating : null,
                    episodes: [] 
                };

                for (const episode of season.episodes) {
                    const watchedDate = new Date(episode.last_watched_at);
                    if (watchedDate < ignoreDate) continue;

                    const episodeId = episodeIdMap.get(`S${season.number}E${episode.number}`);
                    const ratingInfo = episodeId ? ratingsMap.get(`episode-${episodeId}`) : null;
                    
                    processedSeason.episodes.push({
                        number: episode.number,
                        watched_at: episode.last_watched_at,
                        rating: ratingInfo ? ratingInfo.rating : null,
                    });
                }
                if (processedSeason.episodes.length > 0) {
                    processed.seasons.push(processedSeason);
                }
            }
            if (processed.seasons.length > 0) {
                processedShows.push(processed);
            }
        }
        return processedShows;
    }

    async processMovieData(movies: TraktWatchedMovie[], ratingsMap: Map<string, any>, ignoreDate: Date): Promise<ProcessedMovie[]> {
        const processedMovies: ProcessedMovie[] = [];
        for (const movie of movies) {
            const watchedDate = new Date(movie.last_watched_at);
            if (watchedDate < ignoreDate) continue;

            const posterUrl = await this.getPosterUrl('movie', movie.movie.ids.trakt);
            const ratingInfo = ratingsMap.get(`movie-${movie.movie.ids.trakt}`);

            processedMovies.push({
                title: movie.movie.title,
                year: movie.movie.year,
                slug: movie.movie.ids.slug,
                posterUrl: posterUrl,
                watched_at: movie.last_watched_at,
                rating: ratingInfo ? ratingInfo.rating : null,
            });
        }
        processedMovies.sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime());
        return processedMovies;
    }

    generateTvShowMarkdown(shows: ProcessedShow[]): string {
        let markdown = '# TV Show Watch Log\n';
        if (shows.length === 0) return markdown + '\n\nNo TV shows watched yet.';

        for (const show of shows) {
            const showRatingText = show.rating ? ` (${formatRating(show.rating)})` : '';

            // Poster in its own table for alignment
            markdown += `## ${show.title}\n\n`;
            markdown += `|  [${show.title}](https://trakt.tv/shows/${show.slug})${showRatingText} | | |\n`;
            markdown += `|:---|:---:|:---:|\n`;
            markdown += `| ![](${show.posterUrl}) |\n`;

            for (const season of show.seasons) {
                const seasonNameText = season.number === 0 ? 'Specials' : `Season ${season.number}`;
                const seasonRatingText = season.rating ? ` (${formatRating(season.rating)})` : '';
                markdown += `| **[${seasonNameText}](https://trakt.tv/shows/${show.slug}/seasons/${season.number})${seasonRatingText}** |\n`;

                for (const episode of season.episodes) {
                    const episodeNumberText = `[${season.number.toString().padStart(2, '0')}x${episode.number.toString().padStart(2, '0')}](https://trakt.tv/shows/${show.slug}/seasons/${season.number}/episodes/${episode.number})`;
                    const dateLink = `[[${dateToJournal(new Date(episode.watched_at))}]]`;
                    const ratingText = formatRating(episode.rating);
                    
                    markdown += `| ${episodeNumberText} | ${dateLink} | ${ratingText} |\n`;
                }
							}
							markdown += '\n'; // Add space after each show's table
						}
        return markdown;
    }

    generateMovieMarkdown(movies: ProcessedMovie[]): string {
        let markdown = '# Movie Watch Log';
        if (movies.length === 0) return markdown + '\n\nNo movies watched yet.';

        markdown += `\n\n| Poster | Details |\n`;
        markdown += `|:---:|:---|\n`;

        for (const movie of movies) {
            const title = `**[${movie.title} (${movie.year})](https://trakt.tv/movies/${movie.slug})**`;
            const dateLink = `[[${dateToJournal(new Date(movie.watched_at))}]]`;
            const ratingText = movie.rating ? `${movie.rating}/10` : 'Not Rated';
            const details = `${title}<br>${dateLink}<br>${ratingText}`;
            markdown += `| ![](${movie.posterUrl}) | ${details} |\n`;
        }
        return markdown;
    }

		async writeFile(filePath: string, content: string): Promise<void> {
        const normalizedPath = normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
        } else {
            await this.app.vault.create(normalizedPath, content);
        }
    }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(settings: TraktSettings) {
		await this.saveData(settings);
	}
}

class TraktSettingTab extends PluginSettingTab {
	plugin: TraktPlugin;
	settings: any
	displayInterval?: unknown

	constructor(app: App, plugin: TraktPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const {containerEl} = this;
		this.settings = await this.plugin.loadData() ?? DEFAULT_SETTINGS

		containerEl.empty();

		new Setting(containerEl)
			.setName('Trakt API key')
			.setDesc('Client API key')
			.addText((component) => {
				component.setValue(this.settings.apiKey ?? '')
				component.onChange(async (value) => {
					this.settings.apiKey = value
					await this.plugin.saveSettings(this.settings)
				})
			})

		new Setting(containerEl)
			.setName('Trakt secret key')
			.setDesc('Secret key')
			.addText((component) => {
				component.setValue(this.settings.secretKey ?? '')
				component.onChange(async (value) => {
					this.settings.secretKey = value
					await this.plugin.saveSettings(this.settings)
				})
			})

		if (this.settings.refresh) {
			clearInterval(this.displayInterval as number)
			new Setting(containerEl)
				.setName('Connected to Trakt')
				.addButton((component) => {
					component.setButtonText('Remove Authorization')
					component.onClick(async () => {
						delete this.settings.refresh
						await this.plugin.saveSettings(this.settings)
						new Notice('Logged out of Trakt account')
						this.display() // Reload
					})
				})
		} else {
			new Setting(containerEl)
				.setName('Connect to Trakt account')
				.addButton((component) => {
					component.setButtonText('Connect')
					component.onClick(() => {
						this.plugin.trakt = new Trakt({
							client_id: this.settings.apiKey,
							client_secret: this.settings.secretKey,
							redirect_uri: 'obsidian://trakt',
							debug: true,
						})
						const traktAuthUrl = this.plugin.trakt.get_url()
						window.location.href = traktAuthUrl
						this.displayInterval = setInterval(() => {
							this.display()
						}, 250)
					})
				})
		}

		new Setting(containerEl)
			.setName('Ignore entries before')
			.setDesc('Any events recorded before this date will be ignored')
			.addText((component) => {
				component.setPlaceholder('2024-01-01')
				component.setValue(this.settings.ignoreBefore)
				component.onChange(async (value) => {
					this.settings.ignoreBefore = value
					await this.plugin.saveSettings(this.settings)
				})
			})
	}
}
