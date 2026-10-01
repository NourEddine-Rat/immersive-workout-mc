# Upload this folder to GitHub

This folder is the complete application. Upload its **contents** so `Procfile`, `requirements.txt`, `.python-version`, `app.json` and `arcade/` are at the repository root. Keep the dotfiles. Do not upload `node_modules`, certificates, logs or test output.

## GitHub Desktop

1. Choose **File → New Repository** and create an empty repository in a new folder.
2. Copy all the files from this folder into that repository folder, including dotfiles.
3. Commit the files, then choose **Publish repository**.
4. In Heroku, create an app, connect this GitHub repository under **Deploy**, select the Python buildpack, and deploy the branch.
5. Under **Resources**, run exactly **one web dyno**. Basic is suitable for an always-on small beta; a database is not needed. Do not enable multiple dynos or autoscaling with these in-memory pairing rooms.

Alternatively, initialize this folder with Git and push it to a new empty GitHub repository:

```sh
git init
git add .
git commit -m "Prepare InMotion direct local beta"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Replace the placeholder with the repository URL GitHub gives you. The GitHub website's upload control is also possible, but make sure it includes all subfolders and dotfiles; GitHub Desktop is less error-prone.

## First hosted test

Open the assigned Heroku HTTPS URL on the PC and scan its QR on the phone. Keep both on the same reachable Wi-Fi/LAN. Allow motion and Local Network access if requested. Heroku handles page loading, pairing and connection setup; motion and game messages use the direct local connection. There is no cloud-motion fallback.

Use [DEPLOY.md](DEPLOY.md) for CLI deployment, custom domains and troubleshooting, [DIRECT-CONNECTION.md](DIRECT-CONNECTION.md) for network requirements, and [TEST-REPORT.md](TEST-REPORT.md) for checks and remaining physical-device testing.
