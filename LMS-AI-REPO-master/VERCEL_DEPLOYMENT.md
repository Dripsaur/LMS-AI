# Vercel deployment

Deploy the backend and frontend as two Vercel projects from the same Git repo.

## Backend project

1. Import the repository into Vercel, name the project `imcc-lms-api`, and set **Root Directory** to `LMS-AI-REPO-master/Backend`.
2. Vercel detects the Express app from `server.js`. The app exports its Express instance and only starts a local listener when run directly.
3. Add these environment variables in the backend project's Vercel settings (Production and Preview as needed):

   - `DATABASE_URL`
   - `CHATBOT_IDENTITY_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `FLOWISE_URL`
   - `FLOWISE_CHATFLOW_ID`
   - `FLOWISE_SYNC_API_KEY`

   Use the existing private `.env` as the source for the values. Do not commit that file. Add any other integration variables the selected routes require.
4. Deploy, then copy the backend's production URL.

## Frontend project

1. Create a second Vercel project from the same repository and set **Root Directory** to `LMS-AI-REPO-master/Frontend`.
2. Set the project name to `imcc-lms-frontend` (or change the API host in `Frontend/vercel.json` to the backend's actual production hostname).
3. Deploy the frontend. Its `vercel.json` proxies `/api/*` and `/uploads/*` to `https://imcc-lms-api.vercel.app`; change that hostname to match the backend deployment before deploying if Vercel assigned a different URL.
4. Add the frontend's production origin to the authorized JavaScript origins for the Google OAuth client configured by `GOOGLE_CLIENT_ID`.

## Before using file uploads in production

The backend currently writes uploaded files and extracted Flowise text to local disk. On Vercel those paths use `/tmp`, which is writable but temporary and isolated to a function instance. Files can disappear between requests or instances, so resource uploads, submissions, and previews need persistent object storage (for example, Supabase Storage) before relying on them. Vercel Functions also impose request payload limits that are below this app's current 25 MB Multer limit. The database and Flowise service must remain reachable from Vercel over the network.
