# 📦 Movers — The UI Foundation That Keeps thriv.es Moving

> Great products are built on great foundations. This is ours.

**Movers** is the open source pnpm workspace monorepo that serves as the shared UI scaffolding behind [thriv.es](https://thriv.es). Think of it as the design system starter kit — the building blocks that keep every interface consistent, fast, and beautiful.

Built with Vite + shadcn/ui + TailwindCSS, it’s the kind of foundation you wish every project started with.

---

## 🌟 What’s Inside

- **Vite-powered** — Blazing fast builds and dev server, no compromises
- **shadcn/ui components** — Accessible, customizable, production-ready out of the box
- **Fluid-responsive Tailwind** — Designs that feel right at every screen size, powered by `fluid-tailwind`
- **Monorepo-ready** — pnpm workspaces with Syncpack keeping dependencies clean across apps and packages
- **TypeScript + ESM** — 100%, no exceptions
- **Biome** — Linting and formatting that actually goes fast

---

## 🏗️ Workspace Structure

```
movers/
├── apps/
│   └── client/          # Starter SaaS app (React + Vite)
└── packages/
    ├── react-ui/        # Core UI components (shadcn/ui home)
    ├── react-layout/    # Reusable headers, footers, navigation
    ├── react-landing/   # Landing page components
    ├── tw-preset-shadcn/     # TailwindCSS preset for shadcn
    ├── tw-preset-workspace/  # Workspace-wide Tailwind customizations
    └── data/            # Shared types, schemas, utilities
```

---

## 🚀 Get Moving

```bash
git clone https://github.com/thriv-es/movers.git
cd movers
pnpm install
pnpm build
pnpm dev          # http://localhost:5173
```

Add a new shadcn component to the workspace:
```bash
pnpm shadcn add button
```

---

## 🤝 Contributing

This is an open source foundation — built to be shared, forked, and improved. If you’re building with Vite + shadcn/ui and want to contribute patterns back, we’d love to collaborate.

1. Fork the repo
2. Create a feature branch
3. Submit a pull request

---

## 👥 Maintainers

This is an open source project, part of the [thriv.es](https://thriv.es) ecosystem.

Collaboratively maintained by [@assafmashiah](https://github.com/assafmashiah) and [@evilUrge](https://github.com/evilUrge), with gratitude to every contributor along the way.

---

*Part of [thriv.es](https://thriv.es) — Where potential meets performance.*
