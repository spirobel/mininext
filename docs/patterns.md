# Mininext Web Framework Patterns

This document outlines useful patterns and conventions extracted from the monero-payment-links codebase using the mininext web framework.

## Table of Contents

1. [Project Structure](#project-structure)
2. [Server Configuration](#server-configuration)
3. [Routing Patterns](#routing-patterns)
4. [HTML Templating](#html-templating)
5. [Frontend Architecture](#frontend-architecture)
6. [Styling Patterns](#styling-patterns)
7. [Data Management](#data-management)
8. [Authentication Patterns](#authentication-patterns)
9. [Component Patterns](#component-patterns)
10. [Development Workflow](#development-workflow)

## Project Structure

```
project/
├── server.ts              # Main server entry point
├── db.ts                  # Database layer with SQL queries
├── package.json           # Dependencies: @spirobel/mininext
├── tsconfig.json          # TypeScript configuration
├── dashboard/             # Admin dashboard module
│   ├── dashboard.ts       # Dashboard skeleton and route
│   ├── login.ts           # Login page and authentication
│   ├── adminSecret.ts     # Admin secret management
│   ├── frontend_main.ts   # Frontend entry point
│   ├── backend/           # API endpoints
│   │   ├── payment_links.ts
│   │   └── wallets.ts
│   ├── frontend/          # Frontend components
│   │   ├── dashboard_router.ts
│   │   ├── sidebar.ts
│   │   ├── payment_links/
│   │   └── wallets/
│   └── styles/
│       └── common.ts      # Global styles
```

## Server Configuration

### Basic Server Setup

```typescript
// server.ts
import { makeRoutes } from "./routes";

const server = Bun.serve({
  port: 3003,
  routes: makeRoutes(),
});

// Hot reload support
globalThis.minireload = () => {
  server.reload({
    routes: makeRoutes(),
    port: 3003,
  });
};

console.log("Server running at http://localhost:3003");
```

### Route Definition Pattern

```typescript
// server.ts - Route aggregation pattern
export function makeRoutes() {
  const routes = {
    ...dashboardSkeleton.static_routes,
    ...loginSkeleton.static_routes,
    "/login": {
      GET: adminLoginGet,
      POST: adminLoginPost,
    },
    "/dashboard": {
      GET: dashBoardRoute,
    },
    "/editPaymentLink": {
      POST: editPaymentLinkRoute,
    },
    "/deletePaymentLink": {
      POST: deletePaymentLinkRoute,
    },
    // ... more routes
  };
  return routes;
}
```

## Routing Patterns

### Backend API Routes

```typescript
// dashboard/backend/payment_links.ts
export async function editPaymentLinkRoute(req: Request) {
  const adminRedirect = await checkAdminAndRedirect(req);
  if (adminRedirect) return adminRedirect;

  try {
    const body = await req.json();

    // Validation pattern
    const errors: any[] = [];
    if (!body.amount || body.amount.trim() === "") {
      errors.push({ path: ["amount"], message: "Amount is required" });
    }

    if (errors.length > 0) {
      return Response.json({
        success: false,
        error: { issues: errors },
      });
    }

    // Business logic
    const paymentLinkId = body.paymentLinkId || crypto.randomUUID();

    // Database operation
    await upsertPaymentLink({
      paymentLinkId: paymentLinkId,
      // ... other fields
    });

    return Response.json({ success: true, paymentLinkId: paymentLinkId });
  } catch (error) {
    console.error("Error saving payment link:", error);
    return Response.json({
      success: false,
      error: {
        issues: [
          { path: ["_form"], message: "An error occurred while saving" },
        ],
      },
    });
  }
}
```

### Frontend Routing with Hash-based Navigation

```typescript
// dashboard/frontend/dashboard_router.ts
import { createRouter, html, type Params } from "@spirobel/mininext";

const routes = {
  "/wallets": dashboardFrontendRoute,
  "/payment-links": paymentLinksRoute,
  "/payment-links/:id": (params: Params<"/payment-links/:id">) => {
    const detailContent = paymentLinkDetailRouteContent(params);
    return html`<div class="layout-container">
      ${sidebar}
      <main class="main-content">
        ${createPaymentLinkForm} ${detailContent}
      </main>
    </div>`;
  },
} as const;

export const router = createRouter(routes);

// Default route navigation
if (!window.location.hash || window.location.hash === "#") {
  router.navigate("/payment-links");
}
```

## HTML Templating

### Skeleton Pattern with Hydration

```typescript
// dashboard/dashboard.ts
import { html } from "@spirobel/mininext";

export const dashboardSkeleton = await html`<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Admin Dashboard - Monero Payment Links</title>
    </head>
    <body data-hydrate="${null}">
      ${mainStyles}
      <script type="module" src="./frontend_main.ts"></script>
      <div id="container"></div>
    </body>
  </html> `.build();

export async function dashBoardRoute(req: Request) {
  const adminRedirect = await checkAdminAndRedirect(req);
  if (adminRedirect) return adminRedirect;

  // Fetch data
  const scan_settings = await readScanSettings();
  const payment_links = await getAllActivePaymentLinks();

  // Hydrate with base64 encoded data
  const hydrate = btoa(JSON.stringify({ scan_settings, payment_links }));
  return new Response(dashboardSkeleton.fill(hydrate));
}
```

### Dynamic Content Injection

```typescript
// dashboard/login.ts
export async function adminLoginGet(req: Request) {
  const url = new URL(req.url);
  const hasError = url.searchParams.get("error") === "1";

  // Conditional content based on query params
  const errorHtml = hasError
    ? html`<div id="error">
        <p class="error">Incorrect password. Try again.</p>
      </div>`
    : html`<div id="error"></div>`;

  const filled = loginSkeleton.fill(errorHtml);
  return new Response(filled);
}
```

## Frontend Architecture

### Root Component Rendering

```typescript
// dashboard/frontend_main.ts
import { html, renderRoot } from "@spirobel/mininext";

const container = document.getElementById("container");
if (!container) throw new Error("Could not find container element");

renderRoot({
  component: () =>
    html`<div style="height: 100%; width: 100%;">${router.component}</div>`,
  container,
});

// Hydrated data access pattern
export function getHydratedData(): DashboardData {
  const b64 = document.body.dataset.hydrate;
  if (!b64) throw new Error("No DashboardData to hydrate");
  return JSON.parse(atob(b64)) as DashboardData;
}

// Global window augmentation
declare global {
  interface Window {
    dashboardData: DashboardData;
    switchActiveTab: () => void;
    createPaymentLink: () => void;
    // ... other global functions
  }
}

window.dashboardData = getHydratedData();
```

### Component Composition Pattern

```typescript
// Example component structure
export function paymentLinksList() {
  const paymentLinks = window.dashboardData.payment_links || [];

  const renderPaymentLink = (link: any) => {
    return html`<a class="payment-link-card" href="${linkUrl}">
      <div class="payment-link-status ${statusClass}"></div>
      <div class="payment-link-info">
        <h3>${title} <span class="${badgeClass}">${badgeText}</span></h3>
        ${detailsHtml}
      </div>
    </a>`;
  };

  return html`<div>
    ${() => {
      const linkElementList: MiniHtmlString[] = [];
      for (const link of paymentLinks) {
        linkElementList.push(renderPaymentLink(link));
      }
      return flatten(
        linkElementList,
        (l) => html`<div class="payment-links-list">${l}</div>`,
      );
    }}
    ${paymentLinksStyles}
  </div>`;
}
```

## Styling Patterns

### CSS-in-JS with Template Literals

```typescript
// dashboard/styles/common.ts
import { html } from "@spirobel/mininext";

export const mainStyles = html`<style>
  :root {
    --primary: #5b21b6;
    --secondary: #4c1d95;
    --accent: #7c3aed;
    --text: #f8fafc;
    --bg: #18181b;
  }

  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    background: var(--bg);
    font-family: "Inter", system-ui, sans-serif;
    color: var(--text);
  }

  .layout-container {
    display: flex;
    min-height: 100vh;
    width: 100%;
  }

  .main-content {
    margin: 20px auto;
    display: flex;
  }
</style>`;
```

### Component-Specific Styles

```typescript
// dashboard/frontend/sidebar.ts
export const sidebarStyles = html`<style>
  .sidebar {
    width: 280px;
    background: var(--primary);
    padding: 2rem 1rem;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--accent);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    color: var(--text);
    text-decoration: none;
    border-radius: 8px;
    transition: all 0.3s ease;
  }

  .menu-item:hover {
    background: rgba(124, 58, 237, 0.2);
    transform: translateX(4px);
  }

  @media (max-width: 768px) {
    .sidebar {
      position: fixed;
      bottom: 0;
      width: 100%;
      height: 60px;
      flex-direction: row;
    }

    .menu-item:hover {
      transform: translateY(-4px);
    }
  }
</style>`;
```

## Data Management

### Database Layer Pattern

```typescript
// db.ts
import { SQL } from "bun";

const sql = new SQL({
  adapter: "sqlite",
  filename: "monero_payments.db",
  create: true,
});

// Table creation with proper types
await sql`
  CREATE TABLE IF NOT EXISTS admin_session_cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
`.execute();

// Type definitions
export type AdminSessionCookieRow = {
  id: number;
  cookie: string;
  timestamp: string;
};

// Query functions with proper typing
export function insertAdminSessionCookie(
  cookie: string,
): SQL.Query<InsertIdRow[]> {
  return sql`
    INSERT INTO admin_session_cookies (cookie)
    VALUES (${cookie})
    RETURNING id
  `.execute();
}
```

### Data Hydration Pattern

```typescript
// Type definition for hydrated data
export type DashboardData = {
  scan_settings?: ScanSettingsOpened;
  payment_links: CombinedPaymentLinkRow[];
};

// Server-side data preparation
const hydrate = btoa(JSON.stringify({ scan_settings, payment_links }));
return new Response(dashboardSkeleton.fill(hydrate));

// Client-side data access
const scanSettings = window.dashboardData.scan_settings;
const walletList = scanSettings?.wallets || [];
```

## Authentication Patterns

### Session Cookie Management

```typescript
// dashboard/login.ts
export async function adminLoginPost(req: Request) {
  const formData = await req.formData();
  const password = formData.get("password") as string;

  // Password validation
  if (!password || password !== (await getAdminSecret())) {
    const headers = new Headers();
    headers.set("Location", "/login?error=1");
    return new Response(null, { status: 303, headers });
  }

  // Generate and store session token
  const token = crypto.randomUUID();
  await insertAdminSessionCookie(token);

  // Set cookie and redirect
  const headers = new Headers();
  headers.set("Location", "/dashboard");
  headers.set("Set-Cookie", `admin_session=${token}; HttpOnly; Path=/`);
  return new Response(null, { status: 303, headers });
}
```

### Authentication Middleware

```typescript
// dashboard/login.ts
export async function checkAdminAndRedirect(req: Request) {
  const cookies = req.headers.get("Cookie");
  const sessionCookie = cookies
    ?.split(";")
    .find((c) => c.trim().startsWith("admin_session="))
    ?.split("=")[1];

  if (!sessionCookie) {
    const url = new URL(req.url);
    if (url.pathname !== "/login") {
      const headers = new Headers();
      headers.set("Location", "/login");
      return new Response(null, { status: 303, headers });
    }
    throw new Error("Not admin, but on /login route");
  }

  // Verify session exists in database
  const session = await getSessionCookieByValue(sessionCookie);
  if (!session) {
    const headers = new Headers();
    headers.set("Location", "/login");
    return new Response(null, { status: 303, headers });
  }

  return null; // User is authenticated
}
```

## Component Patterns

### Reusable Form Components

```typescript
// Example form component pattern
export function createPaymentLinkForm() {
  return html`<div class="dialog-overlay" id="paymentLinkFormOverlay">
    <div class="dialog">
      <div class="dialog-header">
        <h2 class="dialog-title">Create Payment Link</h2>
        <button class="close-btn" onclick="closePaymentLinkForm()">×</button>
      </div>
      <form id="paymentLinkForm" onsubmit="handlePaymentLinkSubmit(event)">
        <div class="form-group">
          <label for="amount">Amount (XMR)</label>
          <input
            type="text"
            id="amount"
            name="amount"
            placeholder="0.5"
            required
          />
        </div>
        <!-- More form fields -->
        <button type="submit" class="submit-btn">Create Link</button>
      </form>
    </div>
  </div>`;
}
```

### List Component with Dynamic Rendering

```typescript
// Pattern for rendering lists with conditional logic
export function paymentLinksList() {
  const paymentLinks = window.dashboardData.payment_links || [];

  return html`<div>
    ${() => {
      if (paymentLinks.length === 0) {
        return html`<div class="empty-state">
          No payment links created yet
        </div>`;
      }

      const linkElementList: MiniHtmlString[] = [];
      for (const link of paymentLinks) {
        linkElementList.push(renderPaymentLink(link));
      }
      return flatten(
        linkElementList,
        (l) => html`<div class="payment-links-list">${l}</div>`,
      );
    }}
  </div>`;
}
```

## Development Workflow

### Hot Reload Setup

```typescript
// Enable hot reload in development
globalThis.minireload = () => {
  server.reload({
    routes: makeRoutes(),
    port: 3003,
  });
};

// Package.json scripts
{
  "scripts": {
    "production": "NODE_ENV=production bun run server.ts",
    "dev": "bun run --hot server.ts"
  }
}
```

## Best Practices

1. **Separation of Concerns**: Keep backend routes, frontend components, and styles in separate directories
2. **Type Safety**: Define TypeScript interfaces for all data structures
3. **Error Handling**: Use consistent error response patterns in API routes
4. **Responsive Design**: Implement mobile-first CSS with media queries
5. **Security**: Always validate user input and use HttpOnly cookies for sessions
6. **Performance**: Minimize data sent to client through selective hydration
7. **Code Organization**: Group related components in feature-based directories
8. **Consistent Naming**: Use camelCase for functions/variables, PascalCase for types/components

## Common Patterns Summary

| Pattern                   | Implementation                      | Purpose                                          |
| ------------------------- | ----------------------------------- | ------------------------------------------------ |
| Skeleton + Hydration      | `html` template with `data-hydrate` | Server-side rendering with client-side hydration |
| Route Aggregation         | `makeRoutes()` function             | Centralized route management                     |
| Authentication Middleware | `checkAdminAndRedirect()`           | Reusable auth checks                             |
| CSS-in-JS                 | Template literal styles             | Scoped, component-specific styling               |
| Database Layer            | Typed SQL queries in `db.ts`        | Type-safe database operations                    |
| Component Composition     | Nested `html` templates             | Reusable UI building blocks                      |
| Form Handling             | FormData parsing with validation    | Consistent form processing                       |
| Error Responses           | Structured JSON error format        | Consistent API error handling                    |

## Getting Started Template

```typescript
// Minimal mininext project structure
import { html } from "@spirobel/mininext";

const skeleton = await html`<!DOCTYPE html>
  <html>
    <head>
      <title>Mininext App</title>
    </head>
    <body data-hydrate="${null}">
      <div id="root"></div>
      <script type="module" src="./frontend.ts"></script>
    </body>
  </html>`.build();

function makeRoutes() {
  return {
    "/": { GET: homeRoute },
    "/api/data": { GET: apiDataRoute },
  };
}

async function homeRoute(req: Request) {
  const data = { message: "Hello Mininext!" };
  const hydrate = btoa(JSON.stringify(data));
  return new Response(skeleton.fill(hydrate));
}

Bun.serve({ port: 3000, routes: makeRoutes() });
```
