/**
 * Knowledge base of the assistant (editable in the admin).
 * Plain-language summaries written for OrgaSport — not copies of official
 * texts. Paragraphs are separated by blank lines: each paragraph becomes a
 * searchable chunk. The official rules of the federation and the rules of
 * each tournament always prevail.
 *
 * Two kinds of sheets:
 * - "help": how the site works (one sheet per feature);
 * - "rules": summary of an official rulebook, with its source, the date of
 *   the version it summarises (the assistant cites « règlement en vigueur au
 *   … ») and the date of the last review (the admin is warned after 12
 *   months). Only enabled sports have rulebook sheets: the others are added
 *   the day they are switched on.
 *
 * TO CHECK by a person before production: each rulebook summary against the
 * official text at its source, then set `versionDate` / `reviewedAt`.
 */
export type KbDoc = {
  title: string;
  sport: string | null;
  source: string | null;
  kind: "help" | "rules";
  /** ISO date: the official version the summary follows (required for "rules"). */
  versionDate?: string;
  /** ISO date: last review of the sheet (required for "rules", given for every help sheet). */
  reviewedAt?: string;
  body: string;
};

/** Official rules of pétanque (FFPJP, French translation of the FIPJP rules). */
const PETANQUE_RULES = { source: "https://www.ffpjp.org", kind: "rules", versionDate: "2026-10-16", reviewedAt: "2026-10-16" } as const;

/** Help sheets about the site: dated by their last review against the site (« fiche à jour au … »). */
const HELP = { source: null, kind: "help", reviewedAt: "2026-10-22" } as const;

export const KB_DOCS: KbDoc[] = [
  {
    title: "Pétanque : déroulement d'une partie",
    sport: "petanque",
    ...PETANQUE_RULES,
    body: `Une partie de pétanque oppose deux équipes : tête-à-tête (1 joueur contre 1, 3 boules chacun), doublette (2 contre 2, 3 boules par joueur) ou triplette (3 contre 3, 2 boules par joueur).

Une partie se joue en 13 points : la première équipe qui atteint 13 points gagne. C'est ce qu'on appelle souvent « la partie en 13 ». Certains concours fixent un autre score ou une limite de temps : le règlement du concours prime.

Une partie se compose de « mènes ». À chaque mène, une équipe lance le but (le cochonnet), puis les équipes jouent toutes leurs boules. À la fin de la mène, l'équipe dont la boule est la plus proche du but marque un point par boule mieux placée que la meilleure boule adverse.

Au début de la partie, un tirage au sort désigne l'équipe qui trace (ou pose) le cercle de lancer et lance le but. Ensuite, c'est l'équipe qui a gagné la mène précédente qui lance le but.

Le joueur lance depuis le cercle, les deux pieds à l'intérieur et sans le toucher, et ne doit pas quitter le sol avant que sa boule soit retombée. Le cercle mesure de 35 à 50 centimètres de diamètre.

Le but doit se trouver entre 6 et 10 mètres du bord intérieur du cercle pour les adultes, et assez loin de tout obstacle ou d'une zone interdite. Les cas où le lancer du but n'est pas valable sont précisés par le règlement officiel de la fédération.

L'équipe qui a lancé le but joue la première boule. Ensuite, c'est toujours l'équipe qui n'a pas « le point » (dont aucune boule n'est la plus proche) qui rejoue, jusqu'à reprendre le point ou épuiser ses boules.

Chaque joueur dispose d'une minute pour jouer sa boule, à partir du moment où la boule ou le but précédent s'est arrêté.

Pointer, c'est lancer sa boule pour qu'elle s'arrête le plus près possible du but. Tirer, c'est lancer sa boule pour chasser une boule adverse (ou le but). Un « carreau » est un tir où la boule tireuse prend exactement la place de la boule frappée.

Perdre 13 à 0, c'est « être fanny » : une tradition populaire, sans conséquence au classement.`,
  },
  {
    title: "Pétanque : matériel",
    sport: "petanque",
    ...PETANQUE_RULES,
    body: `En compétition officielle, les boules sont en métal, d'un diamètre de 70,5 à 80 millimètres et d'un poids de 650 à 800 grammes. Elles portent les marques du fabricant et un numéro.

Le but (cochonnet) est en bois ou en matière synthétique, d'environ 30 millimètres de diamètre.

Pour un concours amical, chacun peut jouer avec ses boules de loisir ; pour un concours officiel réservé aux licenciés, les boules doivent être homologuées.`,
  },
  {
    title: "Pétanque : formats de concours",
    sport: "petanque",
    ...HELP,
    body: `Élimination directe : les équipes sont tirées au sort par paires, le vainqueur continue, le perdant est éliminé (ou va au concours complémentaire). Avec un nouveau tirage à chaque tour, les rencontres du tour suivant sont tirées au sort parmi les gagnants ; avec un tableau fixe, le parcours jusqu'à la finale est connu dès le départ.

Concours complémentaire : un second tableau pour les équipes éliminées tôt (par exemple les perdants du premier tour), pour que tout le monde joue plusieurs parties.

Poules puis phase finale : par poules de 4, chaque équipe joue 2 ou 3 parties (gagnants contre gagnants, perdants contre perdants, puis une partie de barrage) ; les 2 premiers de chaque poule vont dans le tableau final.

Système suisse (parties fixes avec classement) : chaque équipe joue le même nombre de parties, contre des adversaires au bilan proche. Le classement final se fait aux victoires, puis à la différence de points.

Mêlée tournante : chacun s'inscrit seul, les équipes sont refaites à chaque partie, et le classement est individuel.

Exempt : quand le nombre d'équipes est impair avant le cadrage, une équipe ne joue pas la partie et la gagne automatiquement 13 à 7 (jamais deux fois la même équipe). Un forfait, lui, se compte 13 à 0.

Cadrage : après la 1re partie (ou la 2e, au choix de l'organisateur), un tour de cadrage ramène le nombre d'équipes à 4, 8, 16, 32 ou 64 ; les parties suivantes se jouent sans exempt. Voir la fiche « le cadrage et les qualifiés d'office ».`,
  },
  {
    title: "Aide OrgaSport : retrouver son match",
    sport: null,
    ...HELP,
    body: `Chaque concours a un code de 4 caractères (par exemple 7KQ2), écrit sur l'affiche avec un QR code. Sur l'accueil d'OrgaSport, tapez le code dans « Retrouver mon tirage » ou scannez le QR code.

Sur la page du concours, tapez votre numéro d'équipe ou votre nom dans « Trouver mon équipe » : vous voyez votre prochain match, votre terrain, l'heure et votre adversaire, puis l'historique de vos parties. La page fonctionne même sans connexion internet rapide et sur un vieux téléphone.

Touchez « C'est mon équipe » : votre équipe sera mise en avant automatiquement la prochaine fois, sur cet appareil, sans créer de compte.

Avec un compte joueur, le bouton « Mon tirage » ouvre directement votre prochain match quand vous jouez un concours en cours.

Pour être prévenu quand votre match est prêt (« À vous ! Terrain 12 · 15 h 40 »), touchez « Me prévenir quand c'est à moi ». Sur iPhone, il faut d'abord ajouter le site à l'écran d'accueil (bouton Partager, puis « Sur l'écran d'accueil »).`,
  },
  {
    title: "Aide OrgaSport : s'inscrire à un concours",
    sport: null,
    ...HELP,
    body: `Ouvrez l'onglet « Concours », choisissez un concours, puis touchez « S'inscrire ». Le formulaire s'adapte au concours : nombre de joueurs, numéro de licence si le concours est réservé aux licenciés, contact du capitaine, acceptation du règlement.

Le numéro de licence sert uniquement à l'organisateur : il n'est jamais affiché publiquement. Le contact du capitaine (téléphone ou email) n'est visible que par l'organisateur.

Après l'inscription, vous recevez votre numéro d'équipe, un fichier pour l'ajouter à votre agenda, et vous pouvez activer les notifications. Si le concours est complet, votre équipe est placée sur liste d'attente.

L'inscription (la mise) se règle sur place, à la table de marque, le jour du concours. Pensez à pointer votre équipe à la table de marque avant l'heure limite indiquée.`,
  },
  {
    title: "Aide OrgaSport : organiser un concours (lien concours)",
    sport: null,
    ...HELP,
    body: `Un club achète un « lien concours » pour chaque concours. Depuis l'espace club, touchez « Créer un concours » : un formulaire en étapes propose des réglages par défaut adaptés au sport, et le brouillon est enregistré automatiquement.

Les étapes : qui gère le concours, informations générales (date, heure, adresse), participants, argent (mise, dotation), déroulement et tirage, terrains, communication, puis récapitulatif et paiement. Un club pressé peut passer directement au récapitulatif avec les réglages par défaut.

Le bouton « Aide-moi à choisir » propose un format adapté au nombre d'équipes, aux terrains disponibles et à l'heure de début, avec le nombre de terrains nécessaires au premier tour. OrgaSport ne donne jamais d'heure de fin : la durée des parties est impossible à prévoir.

Le paiement se fait sur la page sécurisée de Stripe (carte bancaire, Apple Pay, Google Pay). Aucune donnée bancaire ne passe par OrgaSport. Le concours est publié automatiquement dès que Stripe confirme le paiement, avec son lien court, son QR code et son affiche A4.

Un code PIN de table de marque est créé au paiement et envoyé par email à l'organisateur ; d'autres PIN peuvent être ajoutés ensuite (voir la fiche « le PIN des bénévoles »).`,
  },
  {
    title: "Aide OrgaSport : la table de marque",
    sport: null,
    ...HELP,
    body: `La table de marque s'ouvre depuis la page du concours (/c/CODE/table), avec le compte de l'organisateur ou un code PIN donné aux bénévoles.

Elle permet de pointer les équipes, d'inscrire sur place, de lancer le tirage (ou de le laisser se faire automatiquement à l'heure prévue), d'attribuer les terrains, de saisir les scores et de voir le classement.

Saisie rapide d'un score : tapez le numéro du terrain puis les deux scores, par exemple « 12 13 7 », puis Entrée.

Toute action peut être corrigée : échanger deux équipes, refaire le tirage d'un tour, déplacer un match, déclarer un forfait, corriger un score. L'onglet Historique liste toutes les actions avec un bouton « Annuler ».

Si le réseau coupe, les saisies restent sur l'appareil et partent automatiquement au retour du réseau. Un témoin « En ligne » ou « Hors ligne » reste toujours visible. En secours, l'onglet Impression imprime le tirage, les feuilles de match et le classement.`,
  },
  {
    title: "Pétanque : règlement officiel — but nul, boules nulles et mesure",
    sport: "petanque",
    ...PETANQUE_RULES,
    body: `Ce résumé suit le règlement officiel de la pétanque publié par la fédération (FFPJP, traduction du règlement international FIPJP). En cas de doute, le texte officiel et le règlement du concours font foi, et l'arbitre tranche.

Boule nulle : une boule qui sort du terrain autorisé est « morte » et ne compte plus pour la mène. Une boule arrêtée par un spectateur ou un arbitre reste à l'endroit où elle s'est arrêtée ; une boule arrêtée volontairement par un joueur de l'équipe qui l'a lancée est annulée.

But nul : si le but sort du terrain ou devient invisible après un tir, la mène est nulle si les deux équipes ont encore des boules à jouer. Si une seule équipe a encore des boules, elle marque autant de points qu'il lui reste de boules. Si aucune équipe n'a plus de boules, la mène est nulle.

Mesure : la mesure d'un point revient au joueur qui a joué la dernière boule ou à l'un de ses coéquipiers ; les adversaires peuvent ensuite mesurer à leur tour. Il est interdit de déplacer les boules ou le but pendant la mesure ; en cas de désaccord, on appelle l'arbitre.

Égalité : si les deux boules les plus proches de chaque équipe sont à égale distance du but, la mène est nulle quand plus personne n'a de boule à jouer ; sinon, l'équipe qui a joué la dernière rejoue, puis l'autre, jusqu'à ce que l'une reprenne le point.

Comportement : un joueur doit se tenir à l'écart (à au moins 2 mètres) pendant que l'adversaire joue, et ne pas le gêner. Les sanctions (avertissement, annulation de la boule jouée ou de la suivante, exclusion) sont décidées par l'arbitre selon le règlement.`,
  },
  {
    title: "Aide OrgaSport : les fonctions du site",
    sport: null,
    ...HELP,
    body: `OrgaSport gère un concours du début à la fin : inscriptions, tirage, terrains, scores et résultats en direct. Il est réservé à la pétanque pour l'instant ; d'autres sports seront ajoutés plus tard.

Pour les joueurs, sans compte : le catalogue des concours (onglet « Concours »), l'inscription en ligne quand l'organisateur l'a ouverte, « Retrouver mon tirage » avec le code ou le QR code de l'affiche, les notifications « À vous ! » et l'ajout du concours à son agenda. Le compte joueur ajoute le fil « Pour vous », les concours suivis et le bouton « Mon tirage » qui ouvre directement le prochain match.

Pour les clubs : l'espace club (tableau de bord, membres, annonces, factures, statistiques), la création d'un concours en quelques minutes, le paiement d'un « lien concours » par concours, l'affiche A4 avec QR code, la table de marque et les PIN des bénévoles.

Le prix du lien concours est affiché au récapitulatif, avant le paiement ; un code promo peut s'appliquer. L'inscription des équipes (la mise) se règle toujours sur place : OrgaSport ne fait pas payer les joueurs.

L'assistant répond aux questions sur le sport et sur le site. Les informations officielles d'un concours (horaires, tirage, terrains, résultats) viennent toujours de la base du concours. OrgaSport ne donne jamais d'heure de fin.`,
  },
  {
    title: "Aide OrgaSport : le PIN des bénévoles",
    sport: null,
    ...HELP,
    body: `Le PIN est un code à donner à un bénévole qui n'a pas de compte : il ouvre la table de marque de ce concours seulement, pendant 24 h, sur son téléphone ou son ordinateur. L'organisateur peut le révoquer à tout moment.

Un PIN de table est créé automatiquement au paiement du concours et envoyé par email à l'organisateur. D'autres PIN peuvent être ajoutés depuis la gestion du concours dans l'espace club, par exemple un par bénévole.

En 3 étapes : l'organisateur crée le PIN, il le donne au bénévole (de vive voix ou avec la fiche bénévole à imprimer, qui porte le QR code de la table de marque et le PIN en grand), puis le bénévole ouvre /c/CODE/table (ou scanne le QR code) et tape le PIN.

Le PIN n'est jamais écrit dans une adresse web. Après trop d'essais faux, la saisie est bloquée un moment sur l'appareil, pour éviter qu'on devine le code. Révoquer un PIN déconnecte les appareils qui l'utilisaient.`,
  },
  {
    title: "Aide OrgaSport : le cadrage et les qualifiés d'office (Office)",
    sport: "petanque",
    ...HELP,
    body: `Le cadrage sert à arriver à un nombre d'équipes « rond » (4, 8, 16, 32, 64…) pour que les parties suivantes se jouent sans exempt. L'organisateur le place après la 1re partie (par défaut) ou après la 2e. Avec des poules, il se fait tout de suite après les poules.

Avant le cadrage, le tirage est intégral et au hasard. Si le nombre d'équipes est impair, une équipe est exempte : elle gagne la partie 13 à 7, et ce n'est jamais deux fois la même équipe.

Au cadrage, s'il reste par exemple 7 équipes, 3 parties se jouent (6 équipes) et 1 équipe est qualifiée d'office : elle passe au tour suivant sans jouer. Sur les tirages, elle apparaît face à « Office ». Les équipes qui jouent le cadrage sont tirées au sort.

Exemples : 13 équipes donnent 6 parties et 1 exempt, il en reste 7 ; puis cadrage de 3 parties et 1 d'office, il en reste 4. Avec 100 équipes, il en reste 50, puis 18 parties de cadrage et 14 d'office, il en reste 32.

Si un double forfait ou un retrait laisse un nombre qui n'est pas « rond », le tour suivant crée automatiquement des places d'office, sans tour supplémentaire. Après le cadrage, les tours s'appellent 1/16, 1/8, 1/4, 1/2 et finale.`,
  },
  {
    title: "Aide OrgaSport : N.H. (équipe non homogène)",
    sport: "petanque",
    ...HELP,
    body: `À côté du nom d'une équipe, OrgaSport affiche son club : « (n° du club / NOM DU CLUB) » quand tous les joueurs sont du même club, ou « (N.H.) » quand l'équipe mélange des joueurs de clubs différents. N.H. veut dire « non homogène ».

Le club de chaque joueur (numéro et nom) est une information publique ; le numéro de licence, lui, reste privé et n'est jamais affiché.

L'option « Éviter deux équipes du même club au 1er tour » s'appuie sur ce club. Une équipe N.H. n'a pas de club pour cette règle. Les noms des joueurs s'affichent en « NOM Prénom », en majuscules pour le nom.`,
  },
  {
    title: "Aide OrgaSport : concours B et C",
    sport: "petanque",
    ...HELP,
    body: `Le concours B (complémentaire) permet aux équipes éliminées tôt de continuer à jouer. Sans poules, il reçoit les perdants de la 1re partie du concours A (l'exempt de la 1re partie n'y va pas). Avec poules, il reçoit les équipes non qualifiées des poules.

Le concours C, en option, reçoit les perdants de la 1re partie du B. Il n'est possible que si le B compte au moins 4 équipes au départ.

Inscription au B ou au C : automatique (toutes les équipes concernées jouent) ou volontaire (seules les équipes inscrites à la table de marque jouent, et l'organisateur lance lui-même le 1er tirage quand tout est encaissé). Le droit d'inscription au B est indiqué pour information et se règle sur place.

Le B et le C ont leur propre cadrage, comme le A, et leur 1re partie est toujours un tirage intégral.`,
  },
  {
    title: "Aide OrgaSport : concours sur 2 jours",
    sport: "petanque",
    ...HELP,
    body: `Un concours peut se jouer sur 2 jours : l'organisateur choisit à la création où le concours s'arrête le soir (avant les 1/16, les 1/8, les 1/4, les 1/2, ou après les poules).

Arrivé à ce point, le tirage automatique s'arrête : les concours A, B et C se mettent en pause en même temps. Les joueurs sont prévenus de la reprise.

À la table de marque, un bandeau « Concours en pause » indique combien d'équipes sont encore en lice. Pendant la nuit, l'organisateur peut encore corriger un score ou un forfait : le tour suivant n'est pas tiré pour autant, ni dans le A, ni dans le B, ni dans le C.

Le lendemain, la table de marque touche « Reprendre le concours » : le tour suivant est tiré et l'enchaînement automatique reprend pour les trois concours. Un tirage manuel du tour suivant du concours A a le même effet : il relance aussi le concours après la pause (B et C compris). Le concours reste « en cours » pendant la nuit, et OrgaSport ne donne aucune heure de fin.`,
  },
  {
    title: "Aide OrgaSport : clôture du concours et suppression des résultats",
    sport: null,
    ...HELP,
    body: `Quand la finale est jouée, le concours est « terminé » : l'organisateur peut encore corriger un score, un forfait ou annuler une action. Le lien concours sert pour un seul concours.

La clôture est définitive : par le bouton « Clore définitivement » à la table de marque, ou automatiquement 24 h après la finale. Ensuite plus aucune action n'est possible : ni correction, ni inscription, ni saisie de score par les capitaines.

Les résultats restent visibles 14 jours après la fin du concours. Ensuite, les noms des joueurs, les contacts, les codes des équipes, les PIN et l'historique des actions sont supprimés, et la page affiche « Résultats supprimés ». Les paiements, les factures et des statistiques anonymes sont conservés.

En filet de sécurité, les contacts et numéros de licence des inscrits ne sont jamais gardés plus de 6 mois après le concours, même si le concours n'a pas été terminé : c'est la promesse affichée sur le formulaire d'inscription.

Le code court d'un concours (par exemple 7KQ2) n'est jamais réattribué à un autre concours.`,
  },
  {
    title: "Aide OrgaSport : pointage, forfaits, exempts et liste d'attente",
    sport: null,
    ...HELP,
    body: `Le jour du concours, chaque équipe se présente à la table de marque, qui la pointe (onglet « Pointage »). Seules les équipes pointées sont tirées : une équipe inscrite mais pas encore là n'entre pas dans le tirage.

Une équipe absente peut être déclarée « Forfait » ; l'organisateur peut annuler ce forfait si elle arrive avant le tirage. Pendant le concours, un forfait sur un match donne la partie à l'adversaire sur le score de forfait (13 à 0 en pétanque).

L'exempt n'est pas un forfait : quand le nombre d'équipes est impair avant le cadrage, une équipe tirée au sort ne joue pas la partie et la gagne 13 à 7, jamais deux fois la même.

Si le concours est complet, les nouvelles équipes vont sur liste d'attente ; la table de marque peut les inscrire si une place se libère. Une équipe peut aussi être inscrite sur place (« Ajouter une équipe sur place »), elle est alors pointée tout de suite.`,
  },
  {
    title: "Aide OrgaSport : saisie des scores par les capitaines",
    sport: null,
    ...HELP,
    body: `Quand l'organisateur l'a choisi, les capitaines saisissent eux-mêmes le score de leur match sur leur téléphone, depuis la page du concours (« Saisir le score (capitaine) »), sans compte.

Chaque équipe a un code équipe à 4 chiffres, donné par la table de marque (il figure sur la liste imprimée). Le capitaine choisit son match, tape « Nous » et « Eux », puis son code équipe.

Le score est validé quand les deux capitaines saisissent le même. S'ils ne sont pas d'accord, le match passe « à vérifier » et la table de marque tranche. La table peut toujours saisir ou corriger un score elle-même.

Après la clôture du concours, la saisie par les capitaines est fermée.`,
  },
];
