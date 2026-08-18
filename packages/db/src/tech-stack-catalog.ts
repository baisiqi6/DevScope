export interface TechStackNode {
  slug: string;
  name: string;
  url: string;
}

interface TechStackDefinition extends TechStackNode {
  matches: (system: string, packageName: string) => boolean;
}

/**
 * 面向产品语义的技术栈目录。这里有意只收录框架、运行时和应用平台，
 * 不把 lodash 等通用库或其 SOURCE_REPO 当成“基石依赖”。
 */
const TECH_STACK_DEFINITIONS: TechStackDefinition[] = [
  {
    slug: "nextjs",
    name: "Next.js",
    url: "https://nextjs.org",
    matches: (s, n) => s === "npm" && n === "next",
  },
  {
    slug: "nuxt",
    name: "Nuxt",
    url: "https://nuxt.com",
    matches: (s, n) => s === "npm" && (n === "nuxt" || n === "nuxt3" || n.startsWith("@nuxt/")),
  },
  {
    slug: "react-native",
    name: "React Native",
    url: "https://reactnative.dev",
    matches: (s, n) => s === "npm" && (n === "react-native" || n.startsWith("@react-native/")),
  },
  {
    slug: "react",
    name: "React",
    url: "https://react.dev",
    matches: (s, n) =>
      s === "npm" &&
      (n === "react" || n === "react-dom" || n === "@types/react" || n === "@types/react-dom"),
  },
  {
    slug: "vue",
    name: "Vue",
    url: "https://vuejs.org",
    matches: (s, n) => s === "npm" && (n === "vue" || n.startsWith("@vue/")),
  },
  {
    slug: "angular",
    name: "Angular",
    url: "https://angular.dev",
    matches: (s, n) => s === "npm" && n.startsWith("@angular/"),
  },
  {
    slug: "svelte",
    name: "Svelte",
    url: "https://svelte.dev",
    matches: (s, n) => s === "npm" && (n === "svelte" || n.startsWith("@sveltejs/")),
  },
  {
    slug: "vite",
    name: "Vite",
    url: "https://vite.dev",
    matches: (s, n) => s === "npm" && (n === "vite" || n.startsWith("@vitejs/")),
  },
  {
    slug: "nestjs",
    name: "NestJS",
    url: "https://nestjs.com",
    matches: (s, n) => s === "npm" && n.startsWith("@nestjs/"),
  },
  {
    slug: "express",
    name: "Express",
    url: "https://expressjs.com",
    matches: (s, n) => s === "npm" && n === "express",
  },
  {
    slug: "spring-boot",
    name: "Spring Boot",
    url: "https://spring.io/projects/spring-boot",
    matches: (s, n) => s === "maven" && n.includes("spring-boot"),
  },
  {
    slug: "spring-framework",
    name: "Spring Framework",
    url: "https://spring.io/projects/spring-framework",
    matches: (s, n) =>
      s === "maven" && (n.startsWith("spring-") || n.includes("org.springframework")),
  },
  {
    slug: "quarkus",
    name: "Quarkus",
    url: "https://quarkus.io",
    matches: (s, n) => s === "maven" && n.includes("quarkus"),
  },
  {
    slug: "micronaut",
    name: "Micronaut",
    url: "https://micronaut.io",
    matches: (s, n) => s === "maven" && n.includes("micronaut"),
  },
  {
    slug: "django",
    name: "Django",
    url: "https://www.djangoproject.com",
    matches: (s, n) => s === "pypi" && n === "django",
  },
  {
    slug: "fastapi",
    name: "FastAPI",
    url: "https://fastapi.tiangolo.com",
    matches: (s, n) => s === "pypi" && n === "fastapi",
  },
  {
    slug: "flask",
    name: "Flask",
    url: "https://flask.palletsprojects.com",
    matches: (s, n) => s === "pypi" && n === "flask",
  },
  {
    slug: "aspnet-core",
    name: "ASP.NET Core",
    url: "https://dotnet.microsoft.com/apps/aspnet",
    matches: (s, n) => s === "nuget" && n.startsWith("microsoft.aspnetcore"),
  },
  {
    slug: "tauri",
    name: "Tauri",
    url: "https://tauri.app",
    matches: (s, n) => s === "cargo" && (n === "tauri" || n.startsWith("tauri-")),
  },
  {
    slug: "axum",
    name: "Axum",
    url: "https://github.com/tokio-rs/axum",
    matches: (s, n) => s === "cargo" && n === "axum",
  },
  {
    slug: "actix-web",
    name: "Actix Web",
    url: "https://actix.rs",
    matches: (s, n) => s === "cargo" && n === "actix-web",
  },
  {
    slug: "gin",
    name: "Gin",
    url: "https://gin-gonic.com",
    matches: (s, n) => s === "go" && (n === "gin" || n.endsWith("/gin")),
  },
  {
    slug: "fiber",
    name: "Fiber",
    url: "https://gofiber.io",
    matches: (s, n) => s === "go" && (n === "fiber" || n.includes("gofiber/fiber")),
  },
];

export function detectTechStack(pkg: { system: string; name: string }): TechStackNode | null {
  const system = pkg.system.trim().toLowerCase();
  const packageName = pkg.name.trim().toLowerCase();
  const definition = TECH_STACK_DEFINITIONS.find((candidate) =>
    candidate.matches(system, packageName),
  );
  if (!definition) return null;
  return { slug: definition.slug, name: definition.name, url: definition.url };
}

export function getTechStackBySlug(slug: string): TechStackNode | null {
  const definition = TECH_STACK_DEFINITIONS.find((candidate) => candidate.slug === slug);
  if (!definition) return null;
  return { slug: definition.slug, name: definition.name, url: definition.url };
}
