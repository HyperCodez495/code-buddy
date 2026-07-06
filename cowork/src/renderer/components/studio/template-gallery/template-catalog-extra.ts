export interface TemplateCard {
  id: string;
  name: string;
  tagline: string;
  prompt: string;
  mockupSvg: string;
}

export const EXTRA_TEMPLATES: TemplateCard[] = [
  {
    id: 'extra-creative-portfolio',
    name: 'Portfolio créatif',
    tagline: 'Une présence visuelle forte pour présenter travaux, démarche et contact.',
    prompt:
      'Crée un portfolio créatif premium pour un designer indépendant avec une direction artistique éditoriale, beaucoup d’espace blanc et des accents violet électrique. Prévois un hero typographique, une grille de projets filtrable, une section processus en trois étapes, des témoignages courts et un contact final très visible.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Portfolio créatif" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#0f1020" stroke="#2d2f55"/><circle cx="252" cy="54" r="34" fill="#8b5cf6" opacity="0.28"/><rect x="34" y="34" width="112" height="12" rx="6" fill="#f8fafc"/><rect x="34" y="56" width="76" height="7" rx="3.5" fill="#a78bfa"/><rect x="34" y="82" width="66" height="28" rx="14" fill="#8b5cf6"/><rect x="184" y="42" width="72" height="82" rx="16" fill="#ffffff" opacity="0.92"/><rect x="206" y="62" width="44" height="8" rx="4" fill="#8b5cf6"/><rect x="206" y="80" width="30" height="6" rx="3" fill="#c4b5fd"/><rect x="36" y="138" width="58" height="34" rx="10" fill="#ffffff" opacity="0.12"/><rect x="108" y="128" width="58" height="44" rx="10" fill="#ffffff" opacity="0.18"/><rect x="180" y="138" width="58" height="34" rx="10" fill="#ffffff" opacity="0.12"/></svg>',
  },
  {
    id: 'extra-personal-blog',
    name: 'Blog personnel',
    tagline: 'Un espace chaleureux pour publier essais, notes et récits au fil du temps.',
    prompt:
      'Génère un blog personnel élégant pour un auteur curieux, avec une ambiance papier crème, une typographie serif expressive et des catégories lisibles. Inclus une page d’accueil avec article à la une, liste chronologique, newsletter, recherche simple et pages d’articles confortables à lire.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Blog personnel" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#fff7ed" stroke="#fed7aa"/><rect x="38" y="30" width="244" height="20" rx="10" fill="#7c2d12" opacity="0.12"/><rect x="54" y="36" width="68" height="8" rx="4" fill="#9a3412"/><rect x="52" y="70" width="138" height="14" rx="7" fill="#431407"/><rect x="52" y="96" width="184" height="7" rx="3.5" fill="#fb923c" opacity="0.65"/><rect x="52" y="112" width="154" height="7" rx="3.5" fill="#fdba74"/><rect x="52" y="140" width="88" height="12" rx="6" fill="#9a3412" opacity="0.18"/><rect x="214" y="74" width="54" height="82" rx="14" fill="#ffffff" stroke="#fed7aa"/><circle cx="241" cy="101" r="16" fill="#fb923c" opacity="0.35"/><rect x="226" y="130" width="30" height="6" rx="3" fill="#9a3412"/></svg>',
  },
  {
    id: 'extra-saas-landing',
    name: 'Landing SaaS',
    tagline: 'Une page de conversion moderne pour expliquer, rassurer et déclencher l’essai.',
    prompt:
      'Conçois une landing SaaS B2B très nette pour un outil de productivité IA, en style glassmorphism discret sur fond bleu nuit. Structure la page avec hero orienté bénéfices, logos clients, trois fonctionnalités illustrées, preuve sociale, pricing simple et CTA répétés.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Landing SaaS" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#061525" stroke="#1e3a5f"/><path d="M44 56 C82 18 158 28 184 72 C210 116 264 92 286 138" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.35"/><rect x="42" y="34" width="236" height="74" rx="18" fill="#ffffff" opacity="0.08"/><rect x="66" y="56" width="112" height="12" rx="6" fill="#e0f2fe"/><rect x="66" y="78" width="78" height="7" rx="3.5" fill="#7dd3fc"/><rect x="190" y="58" width="54" height="26" rx="13" fill="#38bdf8"/><rect x="52" y="132" width="58" height="40" rx="12" fill="#ffffff" opacity="0.1"/><rect x="131" y="132" width="58" height="40" rx="12" fill="#ffffff" opacity="0.16"/><rect x="210" y="132" width="58" height="40" rx="12" fill="#ffffff" opacity="0.1"/><circle cx="160" cy="152" r="10" fill="#38bdf8" opacity="0.55"/></svg>',
  },
  {
    id: 'extra-analytics-dashboard',
    name: 'Dashboard analytics',
    tagline: 'Un cockpit clair pour suivre métriques, tendances et alertes opérationnelles.',
    prompt:
      'Crée un dashboard analytics complet pour une équipe growth, avec thème sombre, cartes KPI contrastées et graphiques lisibles. Prévois une navigation latérale, filtres de période, courbe d’acquisition, barres de conversion, tableau des campagnes et alertes actionnables.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Dashboard analytics" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#0b1120" stroke="#273449"/><rect x="28" y="28" width="50" height="144" rx="14" fill="#111827"/><rect x="94" y="30" width="52" height="36" rx="10" fill="#22c55e" opacity="0.2"/><rect x="158" y="30" width="52" height="36" rx="10" fill="#38bdf8" opacity="0.2"/><rect x="222" y="30" width="52" height="36" rx="10" fill="#f59e0b" opacity="0.2"/><rect x="94" y="84" width="116" height="82" rx="14" fill="#111827" stroke="#273449"/><polyline points="108,142 130,124 152,132 174,104 198,114" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="226" y="84" width="48" height="82" rx="14" fill="#111827" stroke="#273449"/><rect x="238" y="132" width="8" height="22" rx="4" fill="#38bdf8"/><rect x="252" y="112" width="8" height="42" rx="4" fill="#38bdf8" opacity="0.7"/></svg>',
  },
  {
    id: 'extra-interactive-quiz',
    name: 'Quiz interactif',
    tagline: 'Une expérience ludique avec questions, progression et score final partageable.',
    prompt:
      'Génère une application de quiz interactive au style pop et accessible, idéale pour tester ses connaissances en quelques minutes. Ajoute une barre de progression, cartes de questions animées, quatre choix clairs, feedback immédiat, écran de score final et possibilité de recommencer.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Quiz interactif" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#fdf2f8" stroke="#fbcfe8"/><rect x="52" y="30" width="216" height="12" rx="6" fill="#f9a8d4"/><rect x="52" y="30" width="128" height="12" rx="6" fill="#ec4899"/><rect x="52" y="62" width="216" height="54" rx="18" fill="#ffffff" stroke="#fbcfe8"/><text x="160" y="94" text-anchor="middle" font-size="28" font-family="Arial, sans-serif" font-weight="700" fill="#be185d">?</text><rect x="52" y="134" width="96" height="24" rx="12" fill="#ec4899" opacity="0.85"/><rect x="172" y="134" width="96" height="24" rx="12" fill="#ffffff" stroke="#f9a8d4"/><rect x="52" y="164" width="96" height="12" rx="6" fill="#ffffff" stroke="#f9a8d4"/><rect x="172" y="164" width="96" height="12" rx="6" fill="#ffffff" stroke="#f9a8d4"/></svg>',
  },
  {
    id: 'extra-ecommerce-showcase',
    name: 'Vitrine e-commerce',
    tagline: 'Une boutique soignée pour mettre en avant produits, collections et panier.',
    prompt:
      'Crée une vitrine e-commerce raffinée pour une marque d’objets design, avec palette sable, noir et accent vert sauge. Prévois un hero collection, grille produits avec badges, fiche produit rapide, panier latéral, réassurance livraison et section éditoriale de marque.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Vitrine e-commerce" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#f5f0e8" stroke="#ddd6c8"/><rect x="38" y="30" width="244" height="30" rx="15" fill="#1f2937"/><rect x="56" y="42" width="58" height="7" rx="3.5" fill="#f5f0e8"/><circle cx="258" cy="45" r="8" fill="#86a789"/><rect x="40" y="82" width="72" height="84" rx="14" fill="#ffffff" stroke="#ddd6c8"/><rect x="124" y="74" width="72" height="92" rx="14" fill="#ffffff" stroke="#86a789"/><rect x="208" y="82" width="72" height="84" rx="14" fill="#ffffff" stroke="#ddd6c8"/><circle cx="160" cy="112" r="22" fill="#86a789" opacity="0.35"/><rect x="142" y="146" width="36" height="8" rx="4" fill="#1f2937"/><rect x="56" y="134" width="38" height="7" rx="3.5" fill="#c7bca9"/><rect x="224" y="134" width="38" height="7" rx="3.5" fill="#c7bca9"/></svg>',
  },
  {
    id: 'extra-documentation-site',
    name: 'Site de documentation',
    tagline: 'Une documentation structurée avec navigation, recherche et exemples de code.',
    prompt:
      'Génère un site de documentation technique pour une API développeur, sobre, rapide et très scannable. Inclue une sidebar hiérarchique, recherche en haut, page de démarrage rapide, blocs de code copiables, callouts de bonnes pratiques et navigation précédent/suivant.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Site de documentation" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#f8fafc" stroke="#cbd5e1"/><rect x="28" y="28" width="66" height="144" rx="12" fill="#e2e8f0"/><rect x="44" y="50" width="34" height="7" rx="3.5" fill="#475569"/><rect x="44" y="72" width="42" height="6" rx="3" fill="#64748b" opacity="0.55"/><rect x="44" y="90" width="30" height="6" rx="3" fill="#2563eb"/><rect x="112" y="30" width="166" height="22" rx="11" fill="#e2e8f0"/><rect x="112" y="72" width="98" height="12" rx="6" fill="#0f172a"/><rect x="112" y="100" width="150" height="48" rx="10" fill="#0f172a"/><rect x="130" y="116" width="74" height="6" rx="3" fill="#60a5fa"/><rect x="130" y="132" width="104" height="6" rx="3" fill="#93c5fd" opacity="0.72"/><rect x="112" y="160" width="76" height="10" rx="5" fill="#2563eb" opacity="0.22"/></svg>',
  },
  {
    id: 'extra-memory-game',
    name: 'Jeu memory',
    tagline: 'Un mini-jeu de cartes retournées, parfait pour une session rapide et visuelle.',
    prompt:
      'Crée un jeu memory responsive avec une ambiance joyeuse, cartes arrondies et micro-interactions fluides. Prévois grille de cartes, compteur de coups, chronomètre, animations de retournement, état de victoire, bouton nouvelle partie et niveaux de difficulté.',
    mockupSvg:
      '<svg role="img" aria-label="Maquette Jeu memory" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="318" height="198" rx="18" fill="#ecfeff" stroke="#a5f3fc"/><rect x="52" y="28" width="94" height="20" rx="10" fill="#0891b2" opacity="0.18"/><rect x="174" y="28" width="94" height="20" rx="10" fill="#0891b2" opacity="0.18"/><rect x="64" y="66" width="44" height="44" rx="12" fill="#06b6d4"/><rect x="122" y="66" width="44" height="44" rx="12" fill="#ffffff" stroke="#67e8f9"/><rect x="180" y="66" width="44" height="44" rx="12" fill="#06b6d4"/><rect x="64" y="124" width="44" height="44" rx="12" fill="#ffffff" stroke="#67e8f9"/><rect x="122" y="124" width="44" height="44" rx="12" fill="#06b6d4" opacity="0.75"/><rect x="180" y="124" width="44" height="44" rx="12" fill="#ffffff" stroke="#67e8f9"/><text x="144" y="97" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" font-weight="700" fill="#0891b2">★</text><text x="86" y="154" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" font-weight="700" fill="#0891b2">★</text></svg>',
  },
];
