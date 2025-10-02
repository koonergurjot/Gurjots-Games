# Deployment

Follow these steps to deploy the game library:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Verify the Worker configuration and static asset bundle with a dry run. This
   smoke test validates `wrangler.toml` before pushing a production deploy:
   ```bash
   npm run deploy:check
   ```
3. Deploy the site to Cloudflare Workers using the Wrangler configuration in
   the repository root:
   ```bash
   npm run deploy
   ```
   The scripts call `npx wrangler deploy --config wrangler.toml`, which uploads
   the static site files and routes requests through `cloudflare/worker.ts`.
4. Configure environment variables as described in [CONFIGURATION](CONFIGURATION.md).
5. Monitor logs and verify the site loads in a browser.

