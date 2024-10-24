import { App, Notice, Plugin, PluginSettingTab, Setting, normalizePath } from 'obsidian';
const Trakt = require('trakt.tv')

const TRAKT_CLIENT = '4d3038be9baf44c391c5c4a99eff23095b41711a6c3b124b48c04ca737196640'
const TRAKT_SECRET = '80502b7c3f410b93d8d141245394fdb70bf45d49443400280b15acb8fc31ff38'

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

interface TraktSettings {
	// Refresh Token
	refresh?: string;
	ignoreBefore: string;
}

const DEFAULT_SETTINGS: TraktSettings = {
	refresh: undefined,
	ignoreBefore: '1970-01-01',
}

function dateToJournal(date: Date) {
	return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

export default class TraktPlugin extends Plugin {
	settings: TraktSettings;
	trakt: any;

	async onload() {
		this.trakt = new Trakt({
			client_id: TRAKT_CLIENT,
			client_secret: TRAKT_SECRET,
			redirect_uri: 'obsidian://trakt-for-obsidian',
			debug: true,
		})
		await this.loadSettings();

		this.addCommand({
			id: 'sync',
			name: 'Sync watched history',
			callback: async () => {
				if (!this.settings.refresh) {
					new Notice('Cannot get authorization')
				}
				const ignore = new Date(this.settings.ignoreBefore)
				const newToken = await this.trakt.import_token(JSON.parse(this.settings.refresh!))
				this.settings.refresh = JSON.stringify(newToken)
				this.saveSettings(this.settings)
				try {
					await this.trakt.refresh_token()
				} catch (e) {
					new Notice('Authentication error, reauthorization required')
				}
				// Get ratings
				const allCheckinsHistory: TraktCheckedInEpisode[] = await this.trakt.sync.ratings.get({ type: 'all' })
				const checkinsSegments: string[] = []
				const checkinSet: Set<string> = new Set()
				for (const show of allCheckinsHistory) {
					const ratedDate = new Date(show.rated_at)
					if (ratedDate > ignore) {
						if (show.episode) {
							checkinSet.add(`${show.show?.title}-${show.episode.season}-${show.episode.number}`)
							checkinsSegments.push(`Gave ${show.rating}/10 to Season ${show.episode?.season}, Episode ${show.episode?.number} of [${show.show?.title}](https://trakt.tv/shows/${show.show?.ids.slug}): ["${show.episode?.title}"](https://trakt.tv/shows/${show.show?.ids.slug}/seasons/${show.episode?.season}/episodes/${show.episode?.number}) on [[${dateToJournal(ratedDate)}]]`)
						} else if (show.show) {
							checkinSet.add(show.show.title)
							checkinsSegments.push(`Gave ${show.rating}/10 to [${show.show?.title}](https://trakt.tv/shows/${show.show?.ids.slug}) on [[${dateToJournal(ratedDate)}]]`)
						}
					}
				}

				// Also include "Finished Watching" where appropriate
				const allWatchedHistory: TraktWatchedShow[] = await this.trakt.sync.watched({ type: 'shows' })
				for (const show of allWatchedHistory) {
					for (const season of show.seasons) {
						for (const episode of season.episodes) {
							const slug = `${show.show.title}-${season.number}-${episode.number}`
							const watchDate = new Date(episode.last_watched_at)
							if (watchDate > ignore && !checkinSet.has(slug)) {
								checkinsSegments.push(`Finished watching Season ${season.number}, Episode ${episode.number} of [${show.show?.title}](https://trakt.tv/shows/${show.show?.ids.slug}) on [[${dateToJournal(watchDate)}]]`)
							}
						}
					}
				}

				const filename = normalizePath('/Trakt Rating History.md')
				const diaryFile = this.app.vault.getFileByPath(filename)
				if (diaryFile === null) {
					this.app.vault.create(filename, `${checkinsSegments.join('\n')}`)
				} else {
					this.app.vault.process(diaryFile, (data) => {
						const diaryContentsArr = data.split('\n')
						const diaryContentsSet = new Set(diaryContentsArr)
						checkinsSegments.forEach((entry: string) => diaryContentsSet.add(entry))
						return `${[...diaryContentsSet].join('\n')}`
					})
				}
				new Notice('Trakt history synced')
			},
		})

		this.addSettingTab(new TraktSettingTab(this.app, this));

		this.registerObsidianProtocolHandler('trakt-for-obsidian', async (data) => {
			const {code, state} = data
			await this.trakt.exchange_code(code, state)
			this.settings.refresh = JSON.stringify(this.trakt.export_token())
			await this.saveSettings(this.settings)
			new Notice('You are now connected to Trakt')
		})
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
		this.settings = await this.plugin.loadData()

		containerEl.empty();

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
