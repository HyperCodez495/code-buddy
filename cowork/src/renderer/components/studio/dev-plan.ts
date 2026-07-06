/**
 * Development plan derived from an app prompt (bolt.new's "plan" step). A
 * deterministic, offline planner: it reads the description, infers the stack and
 * the features, and emits an ordered checklist of build steps. Pure + testable;
 * an LLM planner can replace/augment it later without changing the UI.
 */
export type PlanStepStatus = 'pending' | 'active' | 'done';

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  status: PlanStepStatus;
}

export interface DevPlan {
  title: string;
  stack: string;
  steps: PlanStep[];
}

interface FeatureRule {
  keys: string[];
  title: string;
  detail: string;
}

// Ordered so the plan reads naturally (structure → data → interactions).
const FEATURE_RULES: FeatureRule[] = [
  { keys: ['todo', 'tâche', 'tache', 'task'], title: 'Liste de tâches', detail: 'Ajout, complétion et suppression des items.' },
  { keys: ['auth', 'login', 'connexion', 'sign in', 'signin'], title: 'Authentification', detail: 'Écran de connexion et état utilisateur.' },
  { keys: ['dashboard', 'tableau de bord'], title: 'Tableau de bord', detail: 'Vue d’ensemble avec cartes de synthèse.' },
  { keys: ['chart', 'graph', 'graphique', 'courbe'], title: 'Visualisations', detail: 'Graphiques des données clés.' },
  { keys: ['table', 'tableau', 'grid', 'grille'], title: 'Tableau de données', detail: 'Colonnes triables et filtrables.' },
  { keys: ['form', 'formulaire'], title: 'Formulaire', detail: 'Champs validés et soumission.' },
  { keys: ['calendar', 'calendrier', 'agenda'], title: 'Calendrier', detail: 'Vue mensuelle et événements.' },
  { keys: ['chat', 'messagerie', 'message'], title: 'Messagerie', detail: 'Fil de messages et saisie.' },
  { keys: ['map', 'carte', 'géo', 'geo'], title: 'Carte', detail: 'Rendu cartographique et marqueurs.' },
  { keys: ['cart', 'panier', 'shop', 'boutique', 'ecommerce', 'e-commerce'], title: 'Panier & produits', detail: 'Catalogue et panier.' },
  { keys: ['gallery', 'galerie', 'photo', 'image'], title: 'Galerie', detail: 'Grille responsive de médias.' },
  { keys: ['timer', 'minuteur', 'chrono', 'pomodoro'], title: 'Minuteur', detail: 'Décompte et contrôles.' },
  { keys: ['blog', 'article', 'cms'], title: 'Articles', detail: 'Liste et page d’article.' },
  { keys: ['landing', 'vitrine', 'portfolio'], title: 'Sections vitrine', detail: 'Hero, features et pied de page.' },
];

function detectStack(p: string): { stack: string; scaffold: string } {
  if (/\bnext(\.js)?\b/.test(p)) return { stack: 'Next.js', scaffold: 'Initialiser le projet Next.js' };
  if (/\bvue\b/.test(p)) return { stack: 'Vue + Vite', scaffold: 'Initialiser le projet Vue (Vite)' };
  if (/\bsvelte\b/.test(p)) return { stack: 'SvelteKit', scaffold: 'Initialiser le projet Svelte' };
  return { stack: 'React + Vite', scaffold: 'Initialiser le projet (Vite + React)' };
}

function titleFrom(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Nouvelle application';
  const firstClause = trimmed.split(/[.,\n]/)[0]!.slice(0, 60).trim();
  return firstClause.charAt(0).toUpperCase() + firstClause.slice(1);
}

/** Build an ordered development plan from a free-text app description. */
export function buildDevPlan(prompt: string): DevPlan {
  const p = (prompt ?? '').toLowerCase();
  const { stack, scaffold } = detectStack(p);

  const steps: PlanStep[] = [];
  const push = (id: string, title: string, detail?: string): void => {
    steps.push({ id, title, ...(detail ? { detail } : {}), status: 'pending' });
  };

  push('scaffold', scaffold, 'Structure, dépendances et point d’entrée.');

  const seen = new Set<string>();
  for (const rule of FEATURE_RULES) {
    if (rule.keys.some((k) => p.includes(k)) && !seen.has(rule.title)) {
      seen.add(rule.title);
      push(`feat-${slug(rule.title)}`, `Construire : ${rule.title}`, rule.detail);
    }
  }
  if (seen.size === 0) {
    push('feat-core', 'Construire l’interface principale', 'Composants et mise en page depuis la description.');
  }

  if (/\b(dark|sombre|night)\b/.test(p)) {
    push('theme-dark', 'Ajouter le thème sombre', 'Palette et bascule clair/sombre.');
  } else if (/\b(couleur|color|brand|thème|theme|palette|design)\b/.test(p)) {
    push('theme', 'Appliquer le thème & le branding', 'Couleurs, typographie et espacements.');
  }

  push('wire', 'Câbler l’état & la navigation', 'Relier les composants et les données.');
  push('run', 'Lancer et vérifier la preview', 'Démarrer le serveur de dev et tester le rendu.');

  return { title: titleFrom(prompt), stack, steps };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
