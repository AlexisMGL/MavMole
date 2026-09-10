(function createViewerLocations(global) {
  "use strict";

  const i18n = global.MavMoleI18n;
  const translations = [
    ["AUDIENCE", "PUBLIC", "PUBLIKUM"],
    ["Your viewers, on the map", "Vos spectateurs sur la carte", "Deine Zuschauer auf der Karte"],
    ["See viewers who choose to share their location with the Moles in this tunnel.", "Retrouvez les spectateurs qui partagent leur position avec les Moles de ce tunnel.", "Sieh Zuschauer, die ihren Standort mit den Moles in diesem Tunnel teilen."],
    ["Viewer locations", "Position des spectateurs", "Zuschauerstandorte"],
    ["Connect to a tunnel to see shared locations.", "Connectez-vous à un tunnel pour voir les positions partagées.", "Verbinde dich mit einem Tunnel, um geteilte Standorte zu sehen."],
    ["No viewer is sharing their location yet.", "Aucun spectateur ne partage encore sa position.", "Noch kein Zuschauer teilt seinen Standort."],
    ["Locations disappear when viewers stop sharing or disconnect.", "Les positions disparaissent à l’arrêt du partage ou à la déconnexion.", "Standorte verschwinden, sobald Zuschauer die Freigabe beenden oder die Verbindung trennen."],
    ["Show all viewers", "Voir tous les spectateurs", "Alle Zuschauer anzeigen"],
    ["Viewers sharing their location", "Spectateurs partageant leur position", "Zuschauer mit Standortfreigabe"],
    ["{count} sharing", "{count} en partage", "{count} teilen ihren Standort"],
    ["Viewer {id}", "Spectateur {id}", "Zuschauer {id}"],
    ["Accuracy ±{meters} m", "Précision ±{meters} m", "Genauigkeit ±{meters} m"],
    ["Map unavailable. Shared locations appear in the list below.", "Carte indisponible. Les positions partagées s’affichent dans la liste ci-dessous.", "Karte nicht verfügbar. Geteilte Standorte erscheinen in der Liste unten."],
    ["Map tiles unavailable. Viewer markers are still visible.", "Fond de carte indisponible. Les repères des spectateurs restent visibles.", "Kartenbilder nicht verfügbar. Zuschauermarkierungen bleiben sichtbar."],
    ["Zoom in", "Zoom avant", "Vergrößern"],
    ["Zoom out", "Zoom arrière", "Verkleinern"],
    ["YOUR LOCATION", "VOTRE POSITION", "DEIN STANDORT"],
    ["Let your Mole know where you are", "Partagez votre position avec votre Mole", "Zeige deinem Mole, wo du bist"],
    ["Optional: share your device location only with the Moles in this tunnel. Sharing stops when you disconnect.", "Facultatif : partagez la position de votre appareil uniquement avec les Moles de ce tunnel. Le partage s’arrête à la déconnexion.", "Optional: Teile deinen Gerätestandort nur mit den Moles in diesem Tunnel. Die Freigabe endet beim Trennen der Verbindung."],
    ["Share my location", "Partager ma position", "Meinen Standort teilen"],
    ["Stop sharing", "Arrêter le partage", "Freigabe beenden"],
    ["Join a tunnel to share your location.", "Rejoignez un tunnel pour partager votre position.", "Tritt einem Tunnel bei, um deinen Standort zu teilen."],
    ["Your location is not shared.", "Votre position n’est pas partagée.", "Dein Standort wird nicht geteilt."],
    ["Waiting for location permission…", "En attente de l’autorisation de localisation…", "Warte auf die Standortberechtigung…"],
    ["Sharing your location with the Moles in this tunnel.", "Votre position est partagée avec les Moles de ce tunnel.", "Dein Standort wird mit den Moles in diesem Tunnel geteilt."],
    ["Location sharing stopped.", "Le partage de position est arrêté.", "Standortfreigabe beendet."],
    ["Location access denied. Allow it in your browser settings to try again.", "Accès à la position refusé. Autorisez-le dans votre navigateur pour réessayer.", "Standortzugriff verweigert. Erlaube ihn in den Browsereinstellungen, um es erneut zu versuchen."],
    ["Your location is unavailable. Try again outside or on another device.", "Votre position est indisponible. Réessayez à l’extérieur ou sur un autre appareil.", "Dein Standort ist nicht verfügbar. Versuche es draußen oder auf einem anderen Gerät erneut."],
    ["Location request timed out. Try again.", "Le délai de localisation est dépassé. Réessayez.", "Zeitüberschreitung bei der Standortabfrage. Versuche es erneut."],
    ["Location sharing requires HTTPS or localhost.", "Le partage de position nécessite HTTPS ou localhost.", "Die Standortfreigabe erfordert HTTPS oder localhost."],
    ["This browser does not support location sharing.", "Ce navigateur ne permet pas le partage de position.", "Dieser Browser unterstützt keine Standortfreigabe."],
    ["Unable to share your location. Please try again.", "Impossible de partager votre position. Réessayez.", "Dein Standort konnte nicht geteilt werden. Versuche es erneut."],
    ["Connecting + forwarding…", "Connexion et transmission…", "Verbinden und übertragen…"],
    ["Connected + forwarding", "Connecté et en transmission", "Verbunden und überträgt"],
    ["Connect + forward", "Connecter et transmettre", "Verbinden und übertragen"],
    ["Required only for private tunnels", "Requis uniquement pour les tunnels privés", "Nur für private Tunnel erforderlich"],
    ["Only for private streams", "Uniquement pour les flux privés", "Nur für private Streams"],
    ["Use exactly the same stream name and password as the existing tunnel.", "Utilisez exactement le nom et le mot de passe du tunnel existant.", "Verwende genau den Namen und das Passwort des bestehenden Tunnels."],
    ["Public mode keeps the one-click demo behavior. Use a unique name to avoid mixing unrelated Moles.", "Le mode public permet une démo en un clic. Choisissez un nom unique pour distinguer vos Moles.", "Der öffentliche Modus ermöglicht eine Demo mit einem Klick. Wähle einen eindeutigen Namen, um deine Moles zu trennen."],
    ["Not connected", "Non connecté", "Nicht verbunden"],
    ["Disconnected", "Déconnecté", "Getrennt"],
    ["Off", "Arrêté", "Aus"],
    ["Off — local dashboard remains active", "Arrêté — le tableau de bord local reste actif", "Aus — das lokale Dashboard bleibt aktiv"],
    ["Connected · {count} MAVLink msg", "Connecté · {count} messages MAVLink", "Verbunden · {count} MAVLink-Nachrichten"],
    ["The URL must start with ws:// or wss://.", "L’URL doit commencer par ws:// ou wss://.", "Die URL muss mit ws:// oder wss:// beginnen."],
    ["Invalid WebSocket URL.", "URL WebSocket invalide.", "Ungültige WebSocket-URL."],
    ["Auto-connecting…", "Connexion automatique…", "Automatische Verbindung…"],
    ["Connecting…", "Connexion…", "Verbindung wird hergestellt…"],
    ["Browser blocked the local WebSocket", "Le navigateur a bloqué le WebSocket local", "Der Browser hat den lokalen WebSocket blockiert"],
    ["Mission Planner unavailable", "Mission Planner indisponible", "Mission Planner nicht verfügbar"],
    ["Auto-connect failed — retry when Mission Planner is ready", "Connexion automatique impossible — réessayez lorsque Mission Planner est prêt", "Automatische Verbindung fehlgeschlagen — erneut versuchen, sobald Mission Planner bereit ist"],
    ["Closed (code {code})", "Fermé (code {code})", "Geschlossen (Code {code})"],
    ["Connected · waiting for MAVLink", "Connecté · en attente de MAVLink", "Verbunden · warte auf MAVLink"],
    ["Waiting for local connection…", "En attente de la connexion locale…", "Warte auf die lokale Verbindung…"],
    ["Off — local connection failed", "Arrêté — échec de la connexion locale", "Aus — lokale Verbindung fehlgeschlagen"],
    ["Off — invalid tunnel configuration", "Arrêté — configuration du tunnel invalide", "Aus — ungültige Tunnelkonfiguration"],
    ["Connection blocked", "Connexion bloquée", "Verbindung blockiert"],
    ["Off — relay connection blocked", "Arrêté — connexion au relais bloquée", "Aus — Verbindung zum Relay blockiert"],
    ["Starting…", "Démarrage…", "Wird gestartet…"],
    ["Connection error", "Erreur de connexion", "Verbindungsfehler"],
    ["Off — relay closed", "Arrêté — relais fermé", "Aus — Relay-Verbindung geschlossen"],
    ["Connected · {stream} · TLS", "Connecté · {stream} · TLS", "Verbunden · {stream} · TLS"],
    ["Connected · {stream} · local unencrypted transport", "Connecté · {stream} · transport local non chiffré", "Verbunden · {stream} · lokale unverschlüsselte Verbindung"],
    ["Forwarding binary frames", "Transmission des trames binaires", "Binärdaten werden übertragen"],
    ["Off — relay connection failed", "Arrêté — échec de la connexion au relais", "Aus — Relay-Verbindung fehlgeschlagen"],
    ["{moles} active Moles · {viewers} viewers", "{moles} Moles actifs · {viewers} spectateurs", "{moles} aktive Moles · {viewers} Zuschauer"],
    ["{count} bytes", "{count} octets", "{count} Bytes"],
    ["No Mole has shared MAVLink yet.", "Aucun Mole n’a encore partagé de données MAVLink.", "Noch kein Mole hat MAVLink-Daten geteilt."],
    ["Live MAVLink", "MAVLink en direct", "MAVLink live"],
    ["Connected · waiting for data", "Connecté · en attente de données", "Verbunden · warte auf Daten"],
    ["Disconnected · trail fading", "Déconnecté · trace en cours d’effacement", "Getrennt · Spur verblasst"],
    ["Waiting for Mole data", "En attente des données Mole", "Warte auf Mole-Daten"],
    ["Connect to a tunnel", "Connectez-vous à un tunnel", "Mit einem Tunnel verbinden"],
    ["{count} active Mole", "{count} Mole actif", "{count} aktiver Mole"],
    ["{count} active Moles", "{count} Moles actifs", "{count} aktive Moles"],
    ["No Mole selected", "Aucun Mole sélectionné", "Kein Mole ausgewählt"],
    ["Receiving {count} separated MAVLink source", "Réception de {count} source MAVLink distincte", "Empfange {count} getrennte MAVLink-Quelle"],
    ["Receiving {count} separated MAVLink sources", "Réception de {count} sources MAVLink distinctes", "Empfange {count} getrennte MAVLink-Quellen"],
    ["Receiving binary stream", "Réception du flux binaire", "Binärstream wird empfangen"],
    ["Not joined", "Non rejoint", "Nicht beigetreten"],
    ["Stopped", "Arrêté", "Gestoppt"],
    ["No frame received yet.", "Aucune trame reçue pour le moment.", "Noch kein Datenpaket empfangen."],
    ["Waiting", "En attente", "Warten"],
  ];
  i18n.register({
    fr: Object.fromEntries(translations.map(([key, fr]) => [key, fr])),
    de: Object.fromEntries(translations.map(([key, , de]) => [key, de])),
  });
  const t = (key, variables) => i18n.t(key, variables);

  function createSharing() {
    const shareButton = document.querySelector("#share-location-button");
    const stopButton = document.querySelector("#stop-sharing-location-button");
    const status = document.querySelector("#location-sharing-status");
    let socket = null;
    let watchId = null;
    let requested = false;
    let generation = 0;
    let state = "Join a tunnel to share your location.";
    const available = Boolean(global.navigator.geolocation);
    const secure = global.isSecureContext !== false;

    function connected() {
      return socket?.readyState === global.WebSocket.OPEN;
    }

    function render() {
      shareButton.disabled = !connected() || requested || !available || !secure;
      stopButton.hidden = !requested;
      shareButton.textContent = t("Share my location");
      stopButton.textContent = t("Stop sharing");
      status.textContent = t(!secure ? "Location sharing requires HTTPS or localhost." :
        !available ? "This browser does not support location sharing." : state);
      status.dataset.state = requested ? "connected" : "idle";
    }

    function stop(nextState = "Location sharing stopped.", notify = true) {
      generation += 1;
      const wasRequested = requested;
      requested = false;
      if (watchId !== null) {
        global.navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (notify && wasRequested && connected()) {
        socket.send(JSON.stringify({ type: "viewer.location.stop" }));
      }
      state = nextState;
      render();
    }

    function start() {
      if (!connected() || requested || !available || !secure) {
        return;
      }
      requested = true;
      const currentGeneration = ++generation;
      state = "Waiting for location permission…";
      render();
      try {
        watchId = global.navigator.geolocation.watchPosition((position) => {
          if (!requested || generation !== currentGeneration || !connected()) {
            return;
          }
          const { latitude, longitude, accuracy } = position.coords;
          socket.send(JSON.stringify({
            type: "viewer.location.share",
            location: { latitude, longitude, accuracy },
          }));
        }, (error) => {
          if (!requested || generation !== currentGeneration) {
            return;
          }
          stop(error.code === 1 ? "Location access denied. Allow it in your browser settings to try again." :
            error.code === 3 ? "Location request timed out. Try again." :
              "Your location is unavailable. Try again outside or on another device.");
        }, { enableHighAccuracy: false, maximumAge: 0, timeout: 20_000 });
      } catch (_error) {
        stop("Unable to share your location. Please try again.");
      }
    }

    shareButton.addEventListener("click", start);
    stopButton.addEventListener("click", () => stop());
    global.addEventListener("mavmole:languagechange", render);
    render();
    return {
      connect(nextSocket) {
        stop("Your location is not shared.");
        socket = nextSocket;
        render();
      },
      disconnect() {
        stop("Join a tunnel to share your location.");
        socket = null;
        render();
      },
      handleControl(control) {
        if (control.type === "viewer.location.status" && control.sharing && requested) {
          state = "Sharing your location with the Moles in this tunnel.";
          render();
        } else if (control.type === "viewer.location.error" && requested) {
          stop("Unable to share your location. Please try again.");
        }
      },
    };
  }

  function createMap() {
    const element = document.querySelector("#viewer-location-map");
    const empty = document.querySelector("#viewer-map-empty");
    const status = document.querySelector("#viewer-map-status");
    const count = document.querySelector("#viewer-location-count");
    const fitButton = document.querySelector("#viewer-map-fit");
    const list = document.querySelector("#viewer-location-list");
    const locations = new Map();
    let connected = false;
    let map = null;
    let tileError = false;
    if (global.L) {
      map = global.L.map(element, { zoomControl: false }).setView([28, 8], 2);
      global.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles &copy; Esri", maxZoom: 19,
      }).on("tileerror", () => { tileError = true; render(); }).addTo(map);
      global.L.control.zoom({ zoomInTitle: t("Zoom in"), zoomOutTitle: t("Zoom out") }).addTo(map);
      if (global.ResizeObserver) {
        new global.ResizeObserver(() => map.invalidateSize()).observe(element);
      }
    }

    function viewerLabel(location) {
      return t("Viewer {id}", { id: location.viewerId.slice(0, 6).toUpperCase() });
    }

    function fit() {
      if (map && locations.size) {
        map.fitBounds(global.L.latLngBounds(Array.from(locations.values(),
          ({ latitude, longitude }) => [latitude, longitude])), { padding: [44, 44], maxZoom: 12 });
      }
    }

    function render() {
      count.textContent = t("{count} sharing", { count: locations.size });
      count.dataset.state = connected && locations.size ? "connected" : "idle";
      empty.hidden = Boolean(map) && connected && locations.size > 0;
      empty.textContent = t(!map ? "Map unavailable. Shared locations appear in the list below." :
        !connected ? "Connect to a tunnel to see shared locations." : "No viewer is sharing their location yet.");
      status.textContent = t(tileError ? "Map tiles unavailable. Viewer markers are still visible." :
        "Locations disappear when viewers stop sharing or disconnect.");
      fitButton.disabled = !map || locations.size === 0;
      fitButton.textContent = t("Show all viewers");
      list.replaceChildren();
      for (const location of locations.values()) {
        const row = document.createElement("li");
        const button = document.createElement("button");
        const accuracy = document.createElement("small");
        button.type = "button";
        button.className = "viewer-location-link";
        button.textContent = viewerLabel(location);
        accuracy.textContent = t("Accuracy ±{meters} m", { meters: i18n.number(Math.round(location.accuracy)) });
        button.disabled = !map;
        button.addEventListener("click", () => {
          map.setView([location.latitude, location.longitude], 12);
          location.marker.openTooltip();
        });
        row.append(button, accuracy);
        list.append(row);
        if (location.marker) {
          const tooltip = document.createElement("span");
          tooltip.textContent = viewerLabel(location) + " · " + accuracy.textContent;
          location.marker.setTooltipContent(tooltip);
        }
      }
      const zoomIn = element.querySelector(".leaflet-control-zoom-in");
      const zoomOut = element.querySelector(".leaflet-control-zoom-out");
      for (const [control, key] of [[zoomIn, "Zoom in"], [zoomOut, "Zoom out"]]) {
        if (control) {
          control.title = t(key);
          control.setAttribute("aria-label", t(key));
        }
      }
    }

    function remove(viewerId) {
      const location = locations.get(viewerId);
      if (location?.marker) map.removeLayer(location.marker);
      locations.delete(viewerId);
    }

    function update(location) {
      if (typeof location.viewerId !== "string" || !Number.isFinite(location.latitude) ||
          Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) ||
          Math.abs(location.longitude) > 180 || !Number.isFinite(location.accuracy)) return;
      const existing = locations.get(location.viewerId);
      let marker = existing?.marker || null;
      if (map) {
        if (marker) {
          marker.setLatLng([location.latitude, location.longitude]);
        } else {
          marker = global.L.marker([location.latitude, location.longitude], {
            icon: global.L.divIcon({ className: "viewer-location-marker", html: '<span class="viewer-location-dot" aria-hidden="true"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
          }).addTo(map).bindTooltip(document.createElement("span"), { direction: "top", offset: [0, -10] });
        }
      }
      locations.set(location.viewerId, { ...location, marker });
      if (!existing) fit();
    }

    fitButton.addEventListener("click", fit);
    global.addEventListener("mavmole:languagechange", render);
    render();
    return {
      connect(initialLocations = []) {
        for (const id of locations.keys()) remove(id);
        connected = true;
        for (const location of initialLocations) update(location);
        map?.invalidateSize();
        render();
      },
      disconnect() {
        connected = false;
        for (const id of locations.keys()) remove(id);
        map?.setView([28, 8], 2);
        render();
      },
      handleControl(control) {
        if (!connected) return;
        if (control.type === "viewer.location.updated") update(control);
        else if (control.type === "viewer.location.removed") remove(control.viewerId);
        else return;
        render();
      },
    };
  }

  global.MavMoleViewerLocations = { createMap, createSharing };
})(window);
