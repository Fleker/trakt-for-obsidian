# Obsidian Trakt Sync

This is an enhanced version of the Trakt.tv Sync plugin for Obsidian. It syncs your watched and rated history for both TV shows and movies from your Trakt.tv account into a structured Markdown file in your vault.

This fork fixes the initial loading issues, removes outdated dependencies, and adds several new features for better organization and usability.

## Features

-   **Sync Shows & Movies:** Fetches both TV show and movie history from your Trakt account.
-   **Structured Markdown Output:** Organizes your history with clear `# Shows` and `# Movies` headings, with each item grouped under its own title.
-   **Detailed History:** Records watched episodes with season/episode numbers (`S01E02`) and includes your personal ratings if available.
-   **User-Configurable Settings:**
    -   Connect securely to your Trakt account via OAuth2.
    -   Set a custom date format for links (e.g., `YYYY.MM.DD`, `YYYY-MM-DD`).
    -   Define a cutoff date to ignore history before a certain point.
-   **Safe & Modern:** Rewritten in TypeScript using the official Obsidian API for stability and future compatibility.

## Example Output

The plugin will generate a file named `Trakt History.md` in your vault root with the following format:

```markdown
# Shows

## 11.22.63
- S01E01 on [[2025.08.18]]
- S01E02 (Rated: 9/10) on [[2025.08.19]]

## 3 Body Problem
- S01E01 on [[2025.08.18]]

# Movies

## Dune: Part Two
- Watch #1 on [[2025.08.20]]

## The Imitation Game
- Rated: 10/10 on [[2025.08.21]]
```

## Setup Instructions

Follow these steps to get the plugin running.

### 1. Create a Trakt.tv API Application

You need to register a personal API application on the Trakt.tv website to get the necessary keys.

1.  Go to the [Trakt.tv API Applications page](https://trakt.tv/oauth/applications). You may need to log in.
2.  Click the **"NEW APPLICATION"** button.
3.  Fill out the form:
    * **Name:** Give it a descriptive name, like `Obsidian Sync Plugin`.
    * **Description:** Briefly describe what it's for.
    * **Redirect URI(s):** This is the most important step. You **must** use this exact value: `obsidian://trakt`
    * **Permissions:** Leave the boxes (`/checkin`, `/scrobble`) unchecked. They are not needed for this plugin.
4.  Click **"SAVE APP"**.
5.  On the next page, you will see your **Client ID** and **Client Secret**. Keep this page open; you will need these keys for the plugin settings.

### 2. Install and Configure the Plugin in Obsidian

1.  Download the `main.js`, `manifest.json`, and `styles.css` files from the [latest release](https://github.com/SİZİN_KULLANICI_ADINIZ/trakt-for-obsidian/releases) of this repository.
2.  In your Obsidian vault, go to `Settings` > `Community plugins` and make sure "Restricted mode" is turned off.
3.  Open the `.obsidian/plugins/` folder in your vault.
4.  Create a new folder named `trakt-tv`.
5.  Place the downloaded `main.js`, `manifest.json`, and `styles.css` files inside this new `trakt-tv` folder.
6.  Go back to Obsidian, go to `Settings` > `Community plugins`, and click the "Reload plugins" button.
7.  Enable the "Trakt.tv Sync" plugin.
8.  Open the settings for the "Trakt.tv Sync" plugin.
9.  Copy the **Client ID** and **Client Secret** from the Trakt website into the corresponding fields in the plugin settings.
10. Click the **"Connect"** button. This will open a Trakt authorization page in your browser.
11. Click **"YES"** to authorize the application. You will be redirected back to Obsidian, and a "Successfully connected" notice should appear.

### 3. Sync Your History

1.  Open the Command Palette in Obsidian (`Ctrl+P` or `Cmd+P`).
2.  Run the command **"Trakt.tv Sync: Sync watched history"**.
3.  The plugin will fetch your history and create/update the `Trakt History.md` file in your vault.

## Contributing

This is a fork of the original [trakt-for-obsidian](https://github.com/Fleker/trakt-for-obsidian) by Nick Felker. Contributions are welcome! If you have ideas for improvements or find a bug, please feel free to open an issue or submit a pull request.