import chalk from "chalk";
import { saveToken } from "../auth.js";
import { getApiUrl } from "../api.js";

/**
 * `icforge dev-auth` — For local development only.
 * Requests a dev token from the backend (requires DEV_MODE=true on server).
 * Skips browser-based OAuth entirely.
 */
export async function devAuthCommand(_options: Record<string, unknown> = {}) {
    const apiUrl = getApiUrl();

    console.log(chalk.cyan("\n🔧 ICForge Dev Auth\n"));
    console.log(chalk.dim(`  Backend: ${apiUrl}`));
    console.log(chalk.dim("  Requesting dev token...\n"));

    try {
        const resp = await fetch(`${apiUrl}/api/v1/auth/dev-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.log(chalk.red("Failed to get dev token:"), text);
            console.log(chalk.dim("\nMake sure the backend is running with DEV_MODE=true"));
            process.exit(1);
        }

        const data = (await resp.json()) as {
            token: string;
            user_id: string;
            dev_mode: boolean;
        };

        // Save with 7-day expiry
        saveToken(data.token, "", 7 * 24 * 3600);

        console.log(chalk.green("✓"), "Authenticated as dev user");
        console.log(chalk.dim(`  User ID: ${data.user_id}`));
        console.log(chalk.dim(`  Token saved locally.\n`));
        console.log("Next: run", chalk.cyan("icforge init"), "to link a project.\n");
    } catch (err) {
        console.log(chalk.red("Connection failed:"), (err as Error).message);
        console.log(chalk.dim(`\nIs the backend running at ${apiUrl}?`));
        process.exit(1);
    }
}
