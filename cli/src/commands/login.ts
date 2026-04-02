import http from 'node:http';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { saveToken } from '../auth.js';
import { getApiUrl } from '../api.js';

export async function loginCommand(_options: Record<string, unknown> = {}) {
    const apiUrl = getApiUrl();

    const { token, username } = await new Promise<{ token: string; username?: string }>((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url!, `http://localhost`);

            if (url.pathname === '/callback') {
                const jwt = url.searchParams.get('token');
                const user = url.searchParams.get('username') ?? undefined;

                if (!jwt) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h1>❌ Login failed</h1><p>No token received. Please try again.</p></body></html>');
                    server.close();
                    reject(new Error('No token received from callback'));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>✅ Logged in to ICForge!</h1><p>You can close this tab and return to your terminal.</p></body></html>');
                server.close();
                resolve({ token: jwt, username: user });
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        // Listen on random port
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('Failed to start local server'));
                return;
            }

            const port = addr.port;
            const callbackUrl = `http://localhost:${port}/callback`;
            const loginUrl = `${apiUrl}/api/v1/auth/login?redirect=${encodeURIComponent(callbackUrl)}`;

            console.log(chalk.cyan('\n🔐  ICForge Login\n'));
            console.log(chalk.dim('Opening browser for GitHub authentication...\n'));

            const spinner = ora('Waiting for authentication...').start();

            // Timeout after 2 minutes
            const timeout = setTimeout(() => {
                spinner.fail('Authentication timed out (2 minutes).');
                server.close();
                reject(new Error('Authentication timed out'));
            }, 2 * 60 * 1000);

            // Once resolved/rejected, clear the timeout
            const origResolve = resolve;
            const origReject = reject;
            resolve = (val) => { clearTimeout(timeout); spinner.stop(); origResolve(val); };
            reject = (err) => { clearTimeout(timeout); spinner.stop(); origReject(err); };

            open(loginUrl).catch(() => {
                spinner.info('Could not open browser automatically.');
                console.log(chalk.dim('\nOpen this URL manually:\n'));
                console.log(chalk.underline(loginUrl));
                console.log();
            });
        });
    });

    // Save the token (7 days expiry)
    saveToken(token, '', 7 * 24 * 3600);

    console.log(chalk.green('✓'), 'Logged in successfully!' + (username ? ` (${chalk.cyan(username)})` : ''));
    console.log(chalk.dim('  Token saved. Run'), chalk.cyan('icforge init'), chalk.dim('to get started.\n'));
}
