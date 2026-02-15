# Simple Chat App (React Router)

A minimal desktop-first chat UI with an Azure OpenAI-backed API endpoint.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- Clean desktop chat layout
- `POST /api/chat` server endpoint
- DefaultAzureCredential + Azure AD token provider auth
- Azure env var placeholders (`.env.example`)
- React Router + TypeScript

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

Create an env file:

```bash
cp .env.example .env
```

Then edit `.env` and set:

- `AZURE_BASE_URL` (or `AZURE_OPENAI_BASE_URL`)
- `AZURE_API_VERSION` (or `AZURE_OPENAI_API_VERSION`)

Auth is done with `DefaultAzureCredential`, so use managed identity / Azure login in your environment.

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
