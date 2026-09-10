(function createMavMoleI18n(global) {
  "use strict";

  const supported = ["en", "fr", "de"];
  const storageKey = "mavmole.language";
  const catalogs = { en: Object.create(null), fr: Object.create(null), de: Object.create(null) };
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const bindings = new Map();
  const numberFormats = new Map();
  const reverseSources = new Map();
  const ignored = "script, style, code, textarea, input, [data-i18n-ignore], [data-i18n-skip]";
  const document = global.document;

  function language(value) {
    const base = String(value || "").toLowerCase().split(/[-_]/)[0];
    return supported.includes(base) ? base : null;
  }

  function initialLanguage() {
    try {
      const saved = language(global.localStorage.getItem(storageKey));
      if (saved) return saved;
    } catch (_error) {
      // The interface also works when browser storage is disabled.
    }
    for (const candidate of global.navigator.languages || [global.navigator.language]) {
      const preferred = language(candidate);
      if (preferred) return preferred;
    }
    return "en";
  }

  let locale = initialLanguage();

  function t(source, variables = {}) {
    const key = String(source ?? "");
    const template = catalogs[locale][key] ?? catalogs.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name)
        ? String(typeof variables[name] === "function" ? variables[name]() : variables[name]) : match,
    );
  }

  function number(value, options = {}) {
    const key = `${locale}:${JSON.stringify(options)}`;
    let formatter = numberFormats.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      numberFormats.set(key, formatter);
    }
    return formatter.format(value);
  }

  function register(entries) {
    for (const code of supported) {
      if (!entries[code]) continue;
      Object.assign(catalogs[code], entries[code]);
      for (const [source, translated] of Object.entries(entries[code])) reverseSources.set(translated, source);
    }
  }

  function original(source) {
    return Object.prototype.hasOwnProperty.call(catalogs.fr, source) || Object.prototype.hasOwnProperty.call(catalogs.de, source)
      ? source : reverseSources.get(source) || source;
  }

  function bind(element, source, variables = {}) {
    if (!element) return;
    source = original(source);
    const binding = { source, variables, last: t(source, variables) };
    if (bindings.size > 128) {
      for (const node of bindings.keys()) if (node.isConnected === false) bindings.delete(node);
    }
    bindings.set(element, binding);
    element.textContent = binding.last;
  }

  function hasBoundParent(element) {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (bindings.has(parent) || parent.hasAttribute?.("data-i18n")) return true;
    }
    return false;
  }

  function translateText(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(ignored) || hasBoundParent(parent)) return;
    const previous = textSources.get(node);
    const current = node.nodeValue;
    const candidate = previous && current === previous.last ? previous.source : current;
    const source = candidate.replace(candidate.trim(), () => original(candidate.trim()));
    const key = source.trim();
    if (!key) return;
    const translated = t(key);
    const last = source.replace(key, () => translated);
    node.nodeValue = last;
    textSources.set(node, { source, last });
  }

  function translateElement(element) {
    if (element.closest("script, style, [data-i18n-ignore], [data-i18n-skip]")) return;
    const explicitKey = element.getAttribute("data-i18n");
    if (explicitKey !== null) element.textContent = t(explicitKey || element.textContent.trim());

    let records = attributeSources.get(element);
    if (!records) {
      records = {};
      attributeSources.set(element, records);
    }
    for (const attr of ["aria-label", "aria-description", "title", "placeholder", "alt", "content"]) {
      if (attr === "content" && !element.matches('meta[name="description"]')) continue;
      const explicit = element.getAttribute(`data-i18n-${attr}`);
      const current = element.getAttribute(attr);
      if (current === null && explicit === null) continue;
      const previous = records[attr];
      const source = explicit ?? original(previous && current === previous.last ? previous.source : current);
      const last = t(source);
      element.setAttribute(attr, last);
      records[attr] = { source, last };
    }
  }

  function apply(root = document) {
    if (!root) return;
    if (root.nodeType === 1) translateElement(root);
    root.querySelectorAll?.("*").forEach(translateElement);
    const walker = document.createTreeWalker(root, global.NodeFilter?.SHOW_TEXT || 4);
    let node;
    while ((node = walker.nextNode())) translateText(node);
    for (const [element, binding] of bindings) {
      if (element.isConnected === false) {
        bindings.delete(element);
        continue;
      }
      // A caller may replace a status without binding; respect that newer value.
      if (element.textContent !== binding.last) {
        bindings.delete(element);
        continue;
      }
      binding.last = t(binding.source, binding.variables);
      element.textContent = binding.last;
    }
    document.documentElement.lang = locale;
    document.querySelectorAll("[data-language-select]").forEach((select) => { select.value = locale; });
  }

  function setLocale(value) {
    const next = language(value) || "en";
    try { global.localStorage.setItem(storageKey, next); } catch (_error) { /* Storage is optional. */ }
    if (locale === next) return;
    locale = next;
    apply();
    global.dispatchEvent(new global.CustomEvent("mavmole:languagechange", { detail: { locale } }));
  }

  global.MavMoleI18n = {
    t, number, register, registerCatalog: register, bind, apply, translateDOM: apply, setLocale,
    get locale() { return locale; },
    supported: Object.freeze([...supported]),
  };

  // Exact English source keys keep the markup readable and provide an English fallback.
  const phrases = [
    ["Language", "Langue", "Sprache"],
    ["Home", "Accueil", "Startseite"],
    ["MavMole home", "Accueil MavMole", "MavMole-Startseite"],
    ["Primary navigation", "Navigation principale", "Hauptnavigation"],
    ["Open Digger", "Ouvrir Digger", "Digger öffnen"],
    ["Open Mole", "Ouvrir Mole", "Mole öffnen"],
    ["Be a Mole — MavMole", "Devenir Mole — MavMole", "Mole werden — MavMole"],
    ["Molehill Telemetry — MavMole", "Télémétrie Molehill — MavMole", "Molehill-Telemetrie — MavMole"],
    ["Connect Mission Planner to the MavMole relay.", "Connectez Mission Planner au relais MavMole.", "Mission Planner mit dem MavMole-Relay verbinden."],
    ["View live MAVLink flight telemetry from a MavMole relay.", "Visualisez la télémétrie MAVLink en direct depuis un relais MavMole.", "MAVLink-Flugtelemetrie von einem MavMole-Relay live ansehen."],
    ["Publisher workspace", "Espace de diffusion", "Sendebereich"],
    ["Connect Mission Planner", "Connecter Mission Planner", "Mission Planner verbinden"],
    ["Inspect Mission Planner telemetry locally, then start or stop relay forwarding independently.", "Consultez la télémétrie Mission Planner en local, puis démarrez ou arrêtez la diffusion indépendamment.", "Mission-Planner-Telemetrie lokal ansehen und die Weiterleitung unabhängig davon starten oder stoppen."],
    ["Customize widgets", "Personnaliser les widgets", "Widgets anpassen"],
    ["Customize", "Personnaliser", "Anpassen"],
    ["Browser permission notice", "Informations sur les autorisations du navigateur", "Hinweis zu Browserberechtigungen"],
    ["Mission Planner stays on your local network.", "Mission Planner reste sur votre réseau local.", "Mission Planner bleibt in Ihrem lokalen Netzwerk."],
    ["Chrome may request local-network access when this HTTPS page connects to the Mission Planner WebSocket.", "Chrome peut demander l’accès au réseau local lorsque cette page HTTPS se connecte au WebSocket de Mission Planner.", "Chrome kann beim Verbinden dieser HTTPS-Seite mit dem Mission-Planner-WebSocket Zugriff auf das lokale Netzwerk anfordern."],
    ["Local source", "Source locale", "Lokale Quelle"],
    ["Connection", "Connexion", "Verbindung"],
    ["Mission Planner WebSocket URL", "URL WebSocket de Mission Planner", "Mission-Planner-WebSocket-URL"],
    ["Mole automatically tries this local endpoint when the page opens. It does not start forwarding.", "Mole tente automatiquement de se connecter à cette adresse locale à l’ouverture de la page. La diffusion reste désactivée.", "Mole versucht beim Öffnen der Seite automatisch, diesen lokalen Endpunkt zu verbinden. Die Weiterleitung bleibt ausgeschaltet."],
    ["Connect locally", "Connecter en local", "Lokal verbinden"],
    ["Disconnect local", "Déconnecter la source", "Lokale Verbindung trennen"],
    ["Relay forwarding", "Diffusion via le relais", "Relay-Weiterleitung"],
    ["Choose a public demo tunnel or protect a named tunnel. Passwords are only sent over the relay connection and are never stored.", "Choisissez un tunnel de démonstration public ou protégez un tunnel nommé. Les mots de passe sont transmis uniquement via la connexion au relais et ne sont jamais conservés.", "Wählen Sie einen öffentlichen Demo-Tunnel oder schützen Sie einen benannten Tunnel. Passwörter werden nur über die Relay-Verbindung übertragen und nie gespeichert."],
    ["Action", "Action", "Aktion"],
    ["Create a tunnel", "Créer un tunnel", "Tunnel erstellen"],
    ["Join an existing tunnel", "Rejoindre un tunnel existant", "Bestehendem Tunnel beitreten"],
    ["Stream name", "Nom du flux", "Streamname"],
    ["Password", "Mot de passe", "Passwort"],
    ["Only for private streams", "Pour les flux privés uniquement", "Nur für private Streams"],
    ["Leave empty for public", "Laisser vide pour un flux public", "Für öffentliche Streams leer lassen"],
    ["Hide and password-protect this stream", "Masquer et protéger ce flux par un mot de passe", "Diesen Stream verbergen und mit einem Passwort schützen"],
    ["Public mode keeps the one-click demo behavior. Use a unique name to avoid mixing unrelated Moles.", "Le mode public permet une démonstration en un clic. Utilisez un nom unique pour éviter de mélanger des Moles sans rapport.", "Der öffentliche Modus ermöglicht die Demo mit einem Klick. Verwenden Sie einen eindeutigen Namen, damit sich unabhängige Moles nicht vermischen."],
    ["Connect + forward", "Connecter et diffuser", "Verbinden und weiterleiten"],
    ["Stop forwarding", "Arrêter la diffusion", "Weiterleitung stoppen"],
    ["Live diagnostics", "Diagnostic en direct", "Live-Diagnose"],
    ["Tunnel status", "État du tunnel", "Tunnelstatus"],
    ["Live", "En direct", "Live"],
    ["Local WebSocket", "WebSocket local", "Lokaler WebSocket"],
    ["MavMole relay", "Relais MavMole", "MavMole-Relay"],
    ["Auto-connecting…", "Connexion automatique…", "Automatische Verbindung…"],
    ["Not connected", "Non connecté", "Nicht verbunden"],
    ["Not joined", "Non rejoint", "Nicht beigetreten"],
    ["Tunnel ID", "Identifiant du tunnel", "Tunnel-ID"],
    ["Server-assigned ephemeral tunnel ID", "Identifiant temporaire du tunnel attribué par le serveur", "Vom Server vergebene temporäre Tunnel-ID"],
    ["Forwarding", "Diffusion", "Weiterleitung"],
    ["Off", "Désactivée", "Aus"],
    ["Stream viewers", "Spectateurs du flux", "Stream-Zuschauer"],
    ["Moles sharing data", "Moles qui diffusent", "Moles mit Datenübertragung"],
    ["Service streams", "Flux du service", "Streams im Dienst"],
    ["0 viewers", "0 spectateur", "0 Zuschauer"],
    ["0 streams", "0 flux", "0 Streams"],
    ["0 active Moles", "0 Mole actif", "0 aktive Moles"],
    ["Frames", "Trames", "Frames"],
    ["Data", "Données", "Daten"],
    ["Current rate", "Débit actuel", "Aktuelle Datenrate"],
    ["Forwarded", "Transmises", "Weitergeleitet"],
    ["Ignored", "Ignorées", "Ignoriert"],
    ["Local Mission Planner stream", "Flux Mission Planner local", "Lokaler Mission-Planner-Stream"],
    ["Mole telemetry", "Télémétrie Mole", "Mole-Telemetrie"],
    ["Waiting for MAVLink", "En attente de MAVLink", "Warten auf MAVLink"],
    ["Navigation", "Navigation", "Navigation"],
    ["Position", "Position", "Position"],
    ["Open map ↗", "Ouvrir la carte ↗", "Karte öffnen ↗"],
    ["Satellite position map", "Carte satellite de la position", "Satellitenkarte der Position"],
    ["Local aircraft trail", "Trajectoire locale de l’aéronef", "Lokale Flugspur"],
    ["Loading satellite", "Chargement satellite", "Satellitenbilder laden"],
    ["Satellite imagery could not load", "Impossible de charger les images satellite", "Satellitenbilder konnten nicht geladen werden"],
    ["Check the internet connection and retry.", "Vérifiez la connexion Internet et réessayez.", "Internetverbindung prüfen und erneut versuchen."],
    ["Retry map", "Recharger la carte", "Karte neu laden"],
    ["Waiting for a valid position", "En attente d’une position valide", "Warten auf eine gültige Position"],
    ["Latitude", "Latitude", "Breitengrad"],
    ["Longitude", "Longitude", "Längengrad"],
    ["Heading", "Cap", "Steuerkurs"],
    ["Waiting for position", "En attente de position", "Warten auf Position"],
    ["Motion", "Mouvement", "Bewegung"],
    ["Airspeed", "Vitesse air", "Fluggeschwindigkeit"],
    ["No airspeed message", "Aucun message de vitesse air", "Keine Fluggeschwindigkeitsdaten"],
    ["Clearance", "Hauteur sol", "Bodenabstand"],
    ["AGL altitude", "Altitude AGL", "Höhe über Grund"],
    ["No AGL source", "Aucune source AGL", "Keine AGL-Quelle"],
    ["Power", "Énergie", "Energie"],
    ["Power system", "Système d’alimentation", "Stromversorgung"],
    ["Battery", "Batterie", "Akku"],
    ["No battery message", "Aucun message de batterie", "Keine Akkudaten"],
    ["Voltage", "Tension", "Spannung"],
    ["Current", "Courant", "Strom"],
    ["Battery remaining", "Charge restante", "Verbleibende Akkuladung"],
    ["Current is displayed as an absolute value", "Le courant est affiché en valeur absolue", "Der Strom wird als Absolutwert angezeigt"],
    ["Navigation integrity", "Intégrité de la navigation", "Navigationsintegrität"],
    ["GNSS dashboard", "Tableau de bord GNSS", "GNSS-Dashboard"],
    ["Waiting for GNSS positions", "En attente des positions GNSS", "Warten auf GNSS-Positionen"],
    ["GNSS satellite map", "Carte satellite GNSS", "GNSS-Satellitenkarte"],
    ["GNSS source colours", "Couleurs des sources GNSS", "Farben der GNSS-Quellen"],
    ["GNSS course indications", "Indications de route GNSS", "GNSS-Kursanzeigen"],
    ["GPS1 ↔ GPS2 drift", "Écart GPS1 ↔ GPS2", "GPS1 ↔ GPS2 Abweichung"],
    ["POS ↔ GPS1 offset", "Décalage POS ↔ GPS1", "POS ↔ GPS1 Versatz"],
    ["POS course", "Route POS", "POS-Kurs"],
    ["GPS1 COG", "Route sol GPS1", "GPS1-Kurs über Grund"],
    ["GPS2 COG", "Route sol GPS2", "GPS2-Kurs über Grund"],
    ["GPS2 satellite count · 60s", "Satellites GPS2 · 60 s", "GPS2-Satellitenanzahl · 60 s"],
    ["GPS2 satellites over 60 seconds", "Satellites GPS2 sur 60 secondes", "GPS2-Satelliten über 60 Sekunden"],
    ["Waiting for GPS2", "En attente de GPS2", "Warten auf GPS2"],
    ["Threshold monitor", "Surveillance des seuils", "Schwellenüberwachung"],
    ["Misc dashboard", "Indicateurs divers", "Weitere Messwerte"],
    ["IMU X load", "Charge IMU X", "IMU-X-Belastung"],
    ["IMU X load over 60 seconds", "Charge IMU X sur 60 secondes", "IMU-X-Belastung über 60 Sekunden"],
    ["Airspeed over 60 seconds", "Vitesse air sur 60 secondes", "Fluggeschwindigkeit über 60 Sekunden"],
    ["Battery current over 60 seconds", "Courant de batterie sur 60 secondes", "Akkustrom über 60 Sekunden"],
    ["Battery 0 current", "Courant de la batterie 0", "Strom von Akku 0"],
    ["Threshold", "Seuil", "Schwelle"],
    ["0.0 s longest", "Durée max. : 0,0 s", "Längste Dauer: 0,0 s"],
    ["Thermal trend", "Évolution thermique", "Temperaturverlauf"],
    ["ESC temperature", "Température ESC", "ESC-Temperatur"],
    ["Waiting for ESC_TELEMETRY_1_TO_4", "En attente de ESC_TELEMETRY_1_TO_4", "Warten auf ESC_TELEMETRY_1_TO_4"],
    ["ESC temperatures, 60 second history and 20 second forecast", "Températures ESC : historique de 60 secondes et prévision de 20 secondes", "ESC-Temperaturen: 60 Sekunden Verlauf und 20 Sekunden Prognose"],
    ["60s ago", "Il y a 60 s", "Vor 60 s"],
    ["Now", "Maintenant", "Jetzt"],
    ["+20s forecast", "Prévision à +20 s", "Prognose +20 s"],
    ["Temperature spread", "Écart de température", "Temperaturdifferenz"],
    ["Estimated time to 85 °C", "Délai estimé avant 85 °C", "Geschätzte Zeit bis 85 °C"],
    ["No rising trend", "Aucune hausse détectée", "Kein Aufwärtstrend"],
    ["Raw stream diagnostics", "Diagnostic du flux brut", "Rohdaten-Diagnose"],
    ["Transport counters and last binary frame", "Compteurs de transport et dernière trame binaire", "Übertragungszähler und letzter binärer Frame"],
    ["WebSocket frames", "Trames WebSocket", "WebSocket-Frames"],
    ["Last binary frame", "Dernière trame binaire", "Letzter binärer Frame"],
    ["HEX · 32 bytes", "HEX · 32 octets", "HEX · 32 Bytes"],
    ["No frame received yet.", "Aucune trame reçue pour le moment.", "Noch kein Frame empfangen."],
    ["MAVLink is decoded only in this browser for the local widgets. Nothing is stored; text frames are ignored.", "MAVLink est décodé uniquement dans ce navigateur pour les widgets locaux. Rien n’est conservé ; les trames texte sont ignorées.", "MAVLink wird nur in diesem Browser für die lokalen Widgets dekodiert. Nichts wird gespeichert; Text-Frames werden ignoriert."],
    ["Local display preferences", "Préférences d’affichage local", "Lokale Anzeigeeinstellungen"],
    ["Display preferences", "Préférences d’affichage", "Anzeigeeinstellungen"],
    ["Customize Mole dashboard", "Personnaliser le tableau de bord Mole", "Mole-Dashboard anpassen"],
    ["Customize dashboard", "Personnaliser le tableau de bord", "Dashboard anpassen"],
    ["Add any observed MAVLink field or configure the built-in dashboards. Settings stay in this browser.", "Ajoutez un champ MAVLink reçu ou configurez les tableaux de bord intégrés. Les réglages restent dans ce navigateur.", "Fügen Sie empfangene MAVLink-Felder hinzu oder konfigurieren Sie die integrierten Dashboards. Einstellungen bleiben in diesem Browser."],
    ["Choose what is visible and how flight values are displayed. Settings stay in this browser.", "Choisissez les éléments visibles et l’affichage des données de vol. Les réglages restent dans ce navigateur.", "Wählen Sie sichtbare Elemente und die Darstellung der Flugdaten. Einstellungen bleiben in diesem Browser."],
    ["Close settings", "Fermer les réglages", "Einstellungen schließen"],
    ["Widgets and order", "Widgets et ordre", "Widgets und Reihenfolge"],
    ["Units and layout", "Unités et disposition", "Einheiten und Layout"],
    ["Airspeed unit", "Unité de vitesse air", "Einheit der Fluggeschwindigkeit"],
    ["Altitude unit", "Unité d’altitude", "Höheneinheit"],
    ["knots", "nœuds", "Knoten"],
    ["metres", "mètres", "Meter"],
    ["feet", "pieds", "Fuß"],
    ["Dashboard layout", "Disposition du tableau de bord", "Dashboard-Layout"],
    ["Balanced", "Équilibrée", "Ausgewogen"],
    ["Equal cards", "Cartes de même taille", "Gleich große Karten"],
    ["Single column", "Une colonne", "Eine Spalte"],
    ["Accent colour", "Couleur d’accent", "Akzentfarbe"],
    ["Custom MAVLink widgets", "Widgets MAVLink personnalisés", "Eigene MAVLink-Widgets"],
    ["Create a value, time graph or gauge from any numeric field observed on this stream.", "Créez une valeur, un graphique temporel ou une jauge à partir d’un champ numérique reçu sur ce flux.", "Erstellen Sie einen Messwert, Zeitverlauf oder eine Anzeige aus einem beliebigen numerischen Feld dieses Streams."],
    ["Create a value, time graph or gauge from any numeric field received directly from Mission Planner.", "Créez une valeur, un graphique temporel ou une jauge à partir d’un champ numérique reçu directement de Mission Planner.", "Erstellen Sie einen Messwert, Zeitverlauf oder eine Anzeige aus einem numerischen Feld direkt von Mission Planner."],
    ["MAVLink field", "Champ MAVLink", "MAVLink-Feld"],
    ["Connect and receive MAVLink first", "Connectez-vous et recevez d’abord du MAVLink", "Zuerst verbinden und MAVLink empfangen"],
    ["Display", "Affichage", "Darstellung"],
    ["Value", "Valeur", "Messwert"],
    ["Time based graph", "Graphique temporel", "Zeitverlauf"],
    ["Gauge", "Jauge", "Anzeige"],
    ["Custom label", "Libellé personnalisé", "Eigene Beschriftung"],
    ["Automatic", "Automatique", "Automatisch"],
    ["Unit", "Unité", "Einheit"],
    ["Optional", "Facultatif", "Optional"],
    ["Decimals", "Décimales", "Dezimalstellen"],
    ["Value transform", "Transformation de la valeur", "Wertumwandlung"],
    ["Absolute value", "Valeur absolue", "Absolutwert"],
    ["Gauge minimum", "Minimum de la jauge", "Anzeigeminimum"],
    ["Gauge maximum", "Maximum de la jauge", "Anzeigemaximum"],
    ["Time window (seconds)", "Fenêtre temporelle (secondes)", "Zeitfenster (Sekunden)"],
    ["Add widget", "Ajouter un widget", "Widget hinzufügen"],
    ["Visual scales", "Échelles visuelles", "Anzeigeskalen"],
    ["Trail points", "Points de trajectoire", "Spurpunkte"],
    ["Airspeed max (m/s)", "Vitesse air max. (m/s)", "Max. Fluggeschwindigkeit (m/s)"],
    ["AGL max (m)", "AGL max. (m)", "Max. Höhe über Grund (m)"],
    ["Dashboard profile", "Profil du tableau de bord", "Dashboard-Profil"],
    ["Export the complete layout as JSON or restore it in another browser.", "Exportez la configuration complète en JSON ou restaurez-la dans un autre navigateur.", "Exportieren Sie das gesamte Layout als JSON oder stellen Sie es in einem anderen Browser wieder her."],
    ["Export JSON", "Exporter en JSON", "JSON exportieren"],
    ["Import JSON", "Importer un JSON", "JSON importieren"],
    ["Reset defaults", "Rétablir les réglages", "Standard wiederherstellen"],
    ["Done", "Terminé", "Fertig"],
    ["Mission Planner → Mole · Relay optional", "Mission Planner → Mole · Relais facultatif", "Mission Planner → Mole · Relay optional"],
    ["Mole → MavMole relay → Molehill", "Mole → Relais MavMole → Molehill", "Mole → MavMole-Relay → Molehill"],
    ["Decoded locally · Nothing stored", "Décodage local · Aucune donnée conservée", "Lokal dekodiert · Nichts gespeichert"],
    ["Molehill · Live viewer", "Molehill · Visualisation en direct", "Molehill · Live-Ansicht"],
    ["Flight telemetry", "Télémétrie de vol", "Flugtelemetrie"],
    ["Follow the aircraft position and essential flight data decoded locally from the incoming MAVLink stream.", "Suivez la position de l’aéronef et les données de vol essentielles, décodées en local depuis le flux MAVLink reçu.", "Verfolgen Sie die Flugposition und wichtige Flugdaten, die lokal aus dem eingehenden MAVLink-Stream dekodiert werden."],
    ["Relay connection", "Connexion au relais", "Relay-Verbindung"],
    ["Relay", "Relais", "Relay"],
    ["Disconnected", "Déconnecté", "Getrennt"],
    ["Stream", "Flux", "Stream"],
    ["Stopped", "Arrêté", "Gestoppt"],
    ["Viewers", "Spectateurs", "Zuschauer"],
    ["Service", "Service", "Dienst"],
    ["Connect to tunnel", "Se connecter au tunnel", "Mit Tunnel verbinden"],
    ["Disconnect", "Déconnecter", "Trennen"],
    ["Three-minute live history", "Historique en direct sur trois minutes", "Drei Minuten Live-Verlauf"],
    ["Mole network map", "Carte du réseau Mole", "Mole-Netzwerkkarte"],
    ["Connect to a tunnel", "Connectez-vous à un tunnel", "Mit einem Tunnel verbinden"],
    ["Map of all active Moles", "Carte de tous les Moles actifs", "Karte aller aktiven Moles"],
    ["Waiting for Mole positions", "En attente des positions des Moles", "Warten auf Mole-Positionen"],
    ["Sources", "Sources", "Quellen"],
    ["Choose which Mole feeds the detailed dashboard.", "Choisissez le Mole affiché dans le tableau de bord détaillé.", "Wählen Sie den Mole für das detaillierte Dashboard."],
    ["Aircraft overview", "Vue d’ensemble de l’aéronef", "Flugübersicht"],
    ["Molehill dashboard", "Tableau de bord Molehill", "Molehill-Dashboard"],
    ["No Mole selected", "Aucun Mole sélectionné", "Kein Mole ausgewählt"],
    ["No data", "Aucune donnée", "Keine Daten"],
    ["Stream name must contain 1 to 48 letters, numbers, spaces, dots, dashes or underscores.", "Le nom du flux doit contenir de 1 à 48 lettres, chiffres, espaces, points, tirets ou traits de soulignement.", "Der Streamname muss 1 bis 48 Buchstaben, Zahlen, Leerzeichen, Punkte, Bindestriche oder Unterstriche enthalten."],
    ["Private tunnel passwords must contain 4 to 128 characters.", "Le mot de passe d’un tunnel privé doit contenir de 4 à 128 caractères.", "Passwörter privater Tunnel müssen 4 bis 128 Zeichen enthalten."],
    ["Tunnel authentication timed out.", "L’authentification au tunnel a expiré.", "Zeitüberschreitung bei der Tunnel-Authentifizierung."],
    ["Unable to join the tunnel.", "Impossible de rejoindre le tunnel.", "Beitritt zum Tunnel fehlgeschlagen."],
    ["Use 1 to 48 letters, numbers, spaces, dots, dashes or underscores.", "Utilisez de 1 à 48 lettres, chiffres, espaces, points, tirets ou traits de soulignement.", "Verwenden Sie 1 bis 48 Buchstaben, Zahlen, Leerzeichen, Punkte, Bindestriche oder Unterstriche."],
    ["Invalid viewer location.", "La position du spectateur est invalide.", "Ungültiger Zuschauerstandort."],
    ["Only authenticated viewers can share their location.", "Seuls les spectateurs authentifiés peuvent partager leur position.", "Nur angemeldete Zuschauer können ihren Standort teilen."],
    ["Invalid tunnel role.", "Rôle de tunnel invalide.", "Ungültige Tunnelrolle."],
    ["This connection already joined a tunnel.", "Cette connexion a déjà rejoint un tunnel.", "Diese Verbindung ist bereits einem Tunnel beigetreten."],
    ["Tunnel not found or credentials are incorrect.", "Tunnel introuvable ou identifiants incorrects.", "Tunnel nicht gefunden oder Zugangsdaten falsch."],
    ["A tunnel with this name already exists with different privacy settings.", "Un tunnel portant ce nom existe déjà avec des réglages de confidentialité différents.", "Ein Tunnel mit diesem Namen existiert bereits mit anderen Privatsphäre-Einstellungen."],
    ["Invalid tunnel authentication.", "Authentification au tunnel invalide.", "Ungültige Tunnel-Authentifizierung."],
    ["Tunnel authentication required.", "Authentification au tunnel requise.", "Tunnel-Authentifizierung erforderlich."],
    ["Too many connection attempts. Try again in one minute.", "Trop de tentatives de connexion. Réessayez dans une minute.", "Zu viele Verbindungsversuche. Versuchen Sie es in einer Minute erneut."],
    ["Too many attempts.", "Trop de tentatives.", "Zu viele Versuche."],
    ["Tunnel authentication failed.", "L’authentification au tunnel a échoué.", "Tunnel-Authentifizierung fehlgeschlagen."],
    ["MavMole server is restarting.", "Le serveur MavMole redémarre.", "Der MavMole-Server wird neu gestartet."],
    ["The relay closed during tunnel authentication.", "Le relais a fermé la connexion pendant l’authentification au tunnel.", "Das Relay hat die Verbindung während der Tunnel-Authentifizierung geschlossen."],
    ["{count} viewer", "{count} spectateur", "{count} Zuschauer"],
    ["{count} viewers", "{count} spectateurs", "{count} Zuschauer"],
    ["{count} stream", "{count} flux", "{count} Stream"],
    ["{count} streams", "{count} flux", "{count} Streams"],
    ["{count} active Mole", "{count} Mole actif", "{count} aktiver Mole"],
    ["{count} active Moles", "{count} Moles actifs", "{count} aktive Moles"],
    ["New Mole sharing MAVLink", "Un nouveau Mole diffuse du MAVLink", "Ein neuer Mole überträgt MAVLink"],
    ["A Mole", "Un Mole", "Ein Mole"],
    ["this stream", "ce flux", "diesem Stream"],
    ["{label} joined {stream}.", "{label} a rejoint {stream}.", "{label} ist {stream} beigetreten."],
    ["Dismiss notification", "Fermer la notification", "Benachrichtigung schließen"],
    ["Service statistics are unavailable.", "Les statistiques du service sont indisponibles.", "Die Dienststatistiken sind nicht verfügbar."],
    ["Public stream list is unavailable.", "La liste des flux publics est indisponible.", "Die Liste öffentlicher Streams ist nicht verfügbar."],
    ["{label} connection failed.", "La connexion à {label} a échoué.", "Verbindung zu {label} fehlgeschlagen."],
    ["{label} closed before connecting (code {code}).", "{label} a fermé la connexion avant son établissement (code {code}).", "{label} wurde vor dem Verbindungsaufbau geschlossen (Code {code})."],
  ];
  for (const [source, fr, de] of phrases) {
    catalogs.fr[source] = fr;
    catalogs.de[source] = de;
    reverseSources.set(fr, source);
    reverseSources.set(de, source);
  }

  if (document) {
    document.documentElement.lang = locale;
    document.addEventListener("change", (event) => {
      if (event.target.matches?.("[data-language-select]")) setLocale(event.target.value);
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(), { once: true });
    else apply();
    global.addEventListener("storage", (event) => {
      if (event.key === storageKey && event.newValue) setLocale(event.newValue);
    });
  }
})(window);
