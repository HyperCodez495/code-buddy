export interface GenerationStack {
  id: string;
  label: string;
  description: string;
  planStack: string;
  guidance: string;
  previewNote: string;
  runnable: boolean;
}

export const GENERATION_STACKS: GenerationStack[] = [
  {
    id: 'static',
    label: 'Web statique',
    description: 'HTML/CSS/JS pur, avec un index.html ouvrable directement et aucun build requis.',
    planStack: 'HTML/CSS/JS',
    guidance:
      '- Stack : génère une application HTML/CSS/JS pur avec index.html, styles intégrés ou fichier CSS simple, script JS autonome, sans dépendance, sans package.json et ouvrable directement dans un navigateur.',
    previewNote: 'Preview disponible via un serveur http.server local exposé en loopback.',
    runnable: true,
  },
  {
    id: 'react-vite',
    label: 'React + Vite',
    description: 'SPA React/TypeScript avec Vite, package.json et commande npm run dev.',
    planStack: 'React + Vite',
    guidance:
      '- Stack : génère une SPA React/TypeScript avec Vite, incluant package.json, index.html, src/main.tsx, src/App.tsx et les styles nécessaires, lançable avec npm run dev.',
    previewNote: 'Preview disponible via le serveur de développement Vite.',
    runnable: true,
  },
  {
    id: 'vue-vite',
    label: 'Vue + Vite',
    description: 'SPA Vue 3/TypeScript avec Vite, package.json et commande npm run dev.',
    planStack: 'Vue + Vite',
    guidance:
      '- Stack : génère une SPA Vue 3/TypeScript avec Vite, incluant package.json, index.html, src/main.ts, src/App.vue et les styles nécessaires, lançable avec npm run dev.',
    previewNote: 'Preview disponible via le serveur de développement Vite.',
    runnable: true,
  },
  {
    id: 'pwa',
    label: 'PWA mobile',
    description:
      'Web app installable sur mobile avec manifest, service worker, icônes et support hors-ligne.',
    planStack: 'PWA (HTML/CSS/JS)',
    guidance:
      '- Stack : génère une PWA mobile en HTML/CSS/JS avec index.html, manifest.webmanifest, service worker enregistré, icônes référencées, meta viewport et stratégie hors-ligne honnête pour les assets locaux.',
    previewNote: "Preview web disponible ; l'application s'installe depuis le navigateur mobile.",
    runnable: true,
  },
  {
    id: 'expo',
    label: 'Mobile (React Native / Expo)',
    description: 'Application mobile native via Expo/React Native avec App.tsx et package.json Expo.',
    planStack: 'React Native (Expo)',
    guidance:
      '- Stack : génère une application React Native/Expo avec App.tsx, package.json Expo, tsconfig si utile, composants compatibles mobile et sans supposer de preview navigateur Cowork.',
    previewNote:
      'Pas de preview dans Cowork ; lance-la avec `npx expo start` sur un appareil ou un émulateur.',
    runnable: false,
  },
];

export function findStack(id: string | undefined): GenerationStack | undefined {
  return GENERATION_STACKS.find((stack) => stack.id === id) ?? GENERATION_STACKS[0];
}
