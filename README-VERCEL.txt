PADIPLAN — VERCEL DEPLOYMENT

This folder is prepared for Vercel serverless deployment. It includes:
- index.html and login.html frontend
- api/[...path].js serverless API (signup, login, logout, teacher)
- Vercel routing configuration

IMPORTANT: The original .env file, Git history, and users.json were intentionally NOT copied into this deployment folder. The uploaded project contained secrets and existing account password hashes. Create a NEW Groq API key if the old one was ever shared or committed.

BEFORE DEPLOYING

1. Create a Groq API key at https://console.groq.com/keys.
2. Create a free Upstash Redis database and copy its REST URL and REST token. This is needed because Vercel functions cannot reliably save accounts to a local JSON file.
3. In Vercel, import this folder/repository as a project.
4. In Vercel Project Settings > Environment Variables, add:
   GROQ_API_KEY       = your new Groq API key
   SESSION_SECRET     = a long random secret (at least 32 random characters)
   KV_REST_API_URL    = your Upstash Redis REST URL
   KV_REST_API_TOKEN  = your Upstash Redis REST token
   TEXT_MODEL         = openai/gpt-oss-120b
   VISION_MODEL       = qwen/qwen3.8-27b
5. Apply the variables to Production (and Preview if needed), save, then redeploy.

HOW TO USE
- Open your Vercel deployment URL.
- Visit /login and create a new account.
- Sign in, then open Teacher and ask a question.

NOTES
- Existing accounts from the old users.json are not migrated. Create a new account after deployment.
- Student planner data remains in each browser's localStorage.
- Account records are stored in Upstash Redis; do not share its credentials.
- If text questions work but photo questions fail, check the current Groq vision model availability and update VISION_MODEL in Vercel.
- Never put secrets in index.html or commit .env.
