# 6. Sessions & historique

Chaque conversation avec l'agent est une **session**. Cowork les garde organisées, cherchables et
reprenables.

## 6.1 Onglets & barre latérale

- Les **onglets** (en haut) fonctionnent comme ceux d'un navigateur — un par session ouverte.
  Basculez d'un clic ou avec `Cmd/Ctrl+1…9`, fermez avec la ×, et épinglez ceux que vous rouvrez.
- La **barre latérale** (à gauche, `Cmd/Ctrl+B` pour l'afficher/masquer) liste vos sessions groupées
  par date, avec une recherche, export/suppression au survol, et un sélecteur de projet.

> _[capture : barre latérale avec sessions groupées]_

## 6.2 Projets

Un **projet** est un profil d'espace de travail — un dossier plus ses propres réglages et sa mémoire.
Créez et changez de projet depuis le sélecteur de la barre latérale ou **Réglages → Projects**.
Utilisez les projets pour garder séparées des codebases sans rapport (et leurs mémoires).

## 6.3 Reprendre le travail

- Au redémarrage, Cowork peut proposer de **reprendre** votre dernière session.
- À tout moment, `Cmd/Ctrl+Maj+O` ouvre le **sélecteur de reprise** : cherchez d'anciennes sessions
  par titre, modèle, espace de travail ou transcription, prévisualisez la conversation, et rouvrez-la
  avec tout son historique restauré.

> _[capture : sélecteur de reprise de session]_

## 6.4 Tout rechercher

`Cmd/Ctrl+P` (ou `Cmd/Ctrl+Maj+K`) ouvre la **recherche globale** sur les sessions, messages, mémoire
et fichiers de l'espace de travail, avec résultats groupés et aperçus. `Cmd/Ctrl+F` cherche dans la
session courante.

## 6.5 Favoris

Mettez une étoile sur n'importe quel message pour le mettre en **favori**. Le panneau **Favoris**
(icône étoile) les rassemble entre projets, avec recherche et navigation en un clic vers le message
d'origine — pratique pour garder de bons extraits, des décisions ou des résultats.

## 6.6 Insights, coût & audit

- **Insights de session** (`Cmd/Ctrl+Maj+I`) — un résumé par session : usage de tokens, coût, appels
  d'outils, temps passé, et une trace rejouable.
- **Coût** — usage de tokens et dépense par provider, avec limites de budget et un compteur en
  direct ; les tendances dans le temps sont dans **Réglages → Cost**.
- **Journal d'audit** — un enregistrement persistant de chaque run et de ses événements ; filtrez par
  statut/date et exportez en CSV.
- **Trace de raisonnement** (`Cmd/Ctrl+Maj+R`) — un arbre des étapes de décision du modèle avec un
  curseur de lecture.
- **Jauge de fenêtre de contexte** — un compteur indiquant le remplissage de la fenêtre de contexte
  du modèle (vert → jaune → rouge), pour compacter ou scinder avant d'atteindre la limite.

> _[capture : insights de session]_

## 6.7 Export & partage

Exportez une session depuis la barre latérale (survol → télécharger) ou la commande `/export` — en
**JSON** (données complètes), **Markdown** (transcription lisible), ou d'autres formats. Une option
d'export partageable peut produire un lien/fichier à transmettre. Sauvegardez ou déplacez tous vos
réglages depuis **Réglages → Import/Export**.
