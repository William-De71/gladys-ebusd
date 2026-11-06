// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration button, widgets, connection status); `text(key, language,
// vars)` returns one string (feature and device names, text states, scene
// action errors: Gladys does not send the language of the user with a scan,
// a command or a scene action, see `language` in config.js). `number(value,
// digits)` formats a number the way each language writes it.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

const m = (en, fr, de, es) => ({ en, fr, de, es });

const MESSAGES = {
  // --- Devices ---------------------------------------------------------------------------------
  device_daemon: m('ebusd', 'ebusd', 'ebusd', 'ebusd'),
  device_boiler: m('Boiler', 'Chaudière', 'Heizkessel', 'Caldera'),
  device_heatpump: m('Heat pump', 'Pompe à chaleur', 'Wärmepumpe', 'Bomba de calor'),
  device_controller: m('Controller', 'Régulateur', 'Regler', 'Regulador'),
  device_mixer: m(
    'Heating circuit',
    'Circuit de chauffage',
    'Heizkreis',
    'Circuito de calefacción',
  ),
  device_hwc: m('Hot water', 'Eau chaude', 'Warmwasser', 'Agua caliente'),
  device_solar: m('Solar', 'Solaire', 'Solar', 'Solar'),
  device_broadcast: m('eBUS broadcast', 'Diffusion eBUS', 'eBUS-Rundruf', 'Difusión eBUS'),
  device_module: m('Module', 'Module', 'Modul', 'Módulo'),
  device_other: m('eBUS device', 'Appareil eBUS', 'eBUS-Gerät', 'Dispositivo eBUS'),
  feature_signal: m('eBUS signal', 'Signal eBUS', 'eBUS-Signal', 'Señal eBUS'),

  // --- Feature names (well-known messages) -----------------------------------------------------
  label_flow: m(
    'Flow temperature',
    'Température de départ',
    'Vorlauftemperatur',
    'Temperatura de impulsión',
  ),
  label_system_flow: m(
    'System flow temperature',
    'Température de départ installation',
    'Systemvorlauftemperatur',
    'Temperatura de impulsión del sistema',
  ),
  label_return: m(
    'Return temperature',
    'Température de retour',
    'Rücklauftemperatur',
    'Temperatura de retorno',
  ),
  label_flow_target: m(
    'Flow temperature target',
    'Consigne de départ',
    'Vorlauf-Solltemperatur',
    'Consigna de impulsión',
  ),
  label_dhw: m(
    'Hot water temperature',
    'Température eau chaude',
    'Warmwassertemperatur',
    'Temperatura del agua caliente',
  ),
  label_storage: m(
    'Tank temperature',
    'Température du ballon',
    'Speichertemperatur',
    'Temperatura del acumulador',
  ),
  label_dhw_target: m(
    'Hot water target',
    'Consigne eau chaude',
    'Warmwasser-Solltemperatur',
    'Consigna de agua caliente',
  ),
  label_pressure: m('Water pressure', 'Pression d’eau', 'Wasserdruck', 'Presión del agua'),
  label_flame: m('Flame', 'Flamme', 'Flamme', 'Llama'),
  label_modulation: m(
    'Burner modulation',
    'Modulation du brûleur',
    'Brennermodulation',
    'Modulación del quemador',
  ),
  label_compressor: m(
    'Compressor load',
    'Charge du compresseur',
    'Verdichterauslastung',
    'Carga del compresor',
  ),
  label_pump: m('Heating pump', 'Pompe de chauffage', 'Heizungspumpe', 'Bomba de calefacción'),
  label_heating_hours: m(
    'Heating hours',
    'Heures de chauffage',
    'Betriebsstunden Heizung',
    'Horas de calefacción',
  ),
  label_dhw_hours: m(
    'Hot water hours',
    'Heures d’eau chaude',
    'Betriebsstunden Warmwasser',
    'Horas de agua caliente',
  ),
  label_heating_starts: m(
    'Heating starts',
    'Démarrages chauffage',
    'Brennerstarts Heizung',
    'Arranques de calefacción',
  ),
  label_dhw_starts: m(
    'Hot water starts',
    'Démarrages eau chaude',
    'Brennerstarts Warmwasser',
    'Arranques de agua caliente',
  ),
  label_compressor_hours: m(
    'Compressor hours',
    'Heures du compresseur',
    'Verdichterstunden',
    'Horas del compresor',
  ),
  label_compressor_starts: m(
    'Compressor starts',
    'Démarrages du compresseur',
    'Verdichterstarts',
    'Arranques del compresor',
  ),
  label_error: m('Current error', 'Erreur en cours', 'Aktueller Fehler', 'Error actual'),
  label_outdoor: m(
    'Outdoor temperature',
    'Température extérieure',
    'Außentemperatur',
    'Temperatura exterior',
  ),
  label_room: m(
    'Room temperature',
    'Température ambiante',
    'Raumtemperatur',
    'Temperatura ambiente',
  ),
  label_room_day: m(
    'Room target (day)',
    'Consigne ambiante (jour)',
    'Raum-Solltemperatur (Tag)',
    'Consigna ambiente (día)',
  ),
  label_room_night: m(
    'Room target (night)',
    'Consigne ambiante (nuit)',
    'Raum-Solltemperatur (Nacht)',
    'Consigna ambiente (noche)',
  ),
  label_room_target: m(
    'Current room target',
    'Consigne ambiante actuelle',
    'Aktuelle Raum-Solltemperatur',
    'Consigna ambiente actual',
  ),
  label_heating_mode: m(
    'Heating mode',
    'Mode chauffage',
    'Betriebsart Heizung',
    'Modo de calefacción',
  ),
  label_dhw_mode: m(
    'Hot water mode',
    'Mode eau chaude',
    'Betriebsart Warmwasser',
    'Modo de agua caliente',
  ),
  label_power_in: m(
    'Electrical power',
    'Puissance électrique',
    'Elektrische Leistung',
    'Potencia eléctrica',
  ),
  label_power_out: m('Heat output', 'Puissance thermique', 'Heizleistung', 'Potencia térmica'),
  label_yield: m('Heat produced', 'Chaleur produite', 'Erzeugte Wärme', 'Calor producido'),
  noError: m('None', 'Aucune', 'Keiner', 'Ninguno'),

  // --- Connection status -----------------------------------------------------------------------
  statusNoHost: m(
    'Enter the address of ebusd in the settings.',
    'Saisissez l’adresse d’ebusd dans les réglages.',
    'Geben Sie die Adresse von ebusd in den Einstellungen ein.',
    'Introduzca la dirección de ebusd en los ajustes.',
  ),
  statusConnecting: m(
    'Connecting to ebusd…',
    'Connexion à ebusd…',
    'Verbindung zu ebusd…',
    'Conectando con ebusd…',
  ),
  statusUnreachable: m(
    'ebusd does not answer at {address} ({error}).',
    'ebusd ne répond pas à {address} ({error}).',
    'ebusd antwortet nicht unter {address} ({error}).',
    'ebusd no responde en {address} ({error}).',
  ),
  statusNoSignal: m(
    'ebusd answers but hears nothing on the eBUS: check the adapter and its wiring.',
    'ebusd répond mais n’entend rien sur l’eBUS : vérifiez l’adaptateur et son câblage.',
    'ebusd antwortet, hört aber nichts auf dem eBUS: Adapter und Verkabelung prüfen.',
    'ebusd responde pero no oye nada en el eBUS: compruebe el adaptador y su cableado.',
  ),
  statusConnected: m(
    'Connected to ebusd {version}: {count} eBUS circuit(s), read only.',
    'Connecté à ebusd {version} : {count} circuit(s) eBUS, en lecture seule.',
    'Mit ebusd {version} verbunden: {count} eBUS-Kreis(e), nur lesen.',
    'Conectado a ebusd {version}: {count} circuito(s) eBUS, solo lectura.',
  ),
  statusConnectedWrites: m(
    'Connected to ebusd {version}: {count} eBUS circuit(s), changes allowed.',
    'Connecté à ebusd {version} : {count} circuit(s) eBUS, modifications autorisées.',
    'Mit ebusd {version} verbunden: {count} eBUS-Kreis(e), Änderungen erlaubt.',
    'Conectado a ebusd {version}: {count} circuito(s) eBUS, cambios permitidos.',
  ),

  // --- Errors (commands and scene actions) -------------------------------------------------------
  errorAuth: m(
    'ebusd refused the user name or the secret.',
    'ebusd a refusé le nom d’utilisateur ou le secret.',
    'ebusd hat den Benutzernamen oder das Geheimnis abgelehnt.',
    'ebusd rechazó el nombre de usuario o el secreto.',
  ),
  errorUnknownDevice: m(
    'This feature is not known to ebusd any more: run a new search.',
    'Cette fonctionnalité n’est plus connue d’ebusd : relancez une recherche.',
    'Diese Funktion ist ebusd nicht mehr bekannt: Suche erneut starten.',
    'ebusd ya no conoce esta función: lance una nueva búsqueda.',
  ),
  errorNoSignal: m(
    'ebusd hears nothing on the eBUS, nothing was sent ({error}).',
    'ebusd n’entend rien sur l’eBUS, rien n’a été envoyé ({error}).',
    'ebusd hört nichts auf dem eBUS, nichts wurde gesendet ({error}).',
    'ebusd no oye nada en el eBUS, no se envió nada ({error}).',
  ),
  errorEbusd: m(
    'ebusd answered: {error}',
    'ebusd a répondu : {error}',
    'ebusd antwortete: {error}',
    'ebusd respondió: {error}',
  ),
  errorUnreachable: m(
    'ebusd does not answer at {address} ({error}).',
    'ebusd ne répond pas à {address} ({error}).',
    'ebusd antwortet nicht unter {address} ({error}).',
    'ebusd no responde en {address} ({error}).',
  ),
  errorNoHost: m(
    'The address of ebusd is not set.',
    'L’adresse d’ebusd n’est pas renseignée.',
    'Die Adresse von ebusd ist nicht gesetzt.',
    'La dirección de ebusd no está configurada.',
  ),
  errorNoField: m(
    'The message has no field "{field}".',
    'Le message n’a pas de champ « {field} ».',
    'Die Nachricht hat kein Feld „{field}“.',
    'El mensaje no tiene el campo «{field}».',
  ),
  errorNoWriteMessage: m(
    'ebusd knows no write message "{message}".',
    'ebusd ne connaît pas de message d’écriture « {message} ».',
    'ebusd kennt keine Schreibnachricht „{message}“.',
    'ebusd no conoce ningún mensaje de escritura «{message}».',
  ),
  writeRefused_disabled: m(
    'Changes are disabled: tick “Allow changes” in the settings of the integration.',
    'Les modifications sont désactivées : cochez « Autoriser les modifications » dans les réglages de l’intégration.',
    'Änderungen sind deaktiviert: „Änderungen erlauben“ in den Einstellungen der Integration aktivieren.',
    'Los cambios están desactivados: marque «Permitir cambios» en los ajustes de la integración.',
  ),
  writeRefused_read_only: m(
    'This value cannot be changed from Gladys.',
    'Cette valeur ne peut pas être modifiée depuis Gladys.',
    'Dieser Wert kann in Gladys nicht geändert werden.',
    'Este valor no se puede cambiar desde Gladys.',
  ),
  writeRefused_range: m(
    'Value refused: {value}.',
    'Valeur refusée : {value}.',
    'Wert abgelehnt: {value}.',
    'Valor rechazado: {value}.',
  ),
  writeRefused_spacing: m(
    'This setting was just changed: try again in {seconds} s.',
    'Ce réglage vient d’être modifié : réessayez dans {seconds} s.',
    'Diese Einstellung wurde gerade geändert: in {seconds} s erneut versuchen.',
    'Este ajuste se acaba de cambiar: vuelva a intentarlo en {seconds} s.',
  ),
  writeRefused_quota: m(
    '{max} changes today already: the next ones tomorrow.',
    'Déjà {max} modifications aujourd’hui : les suivantes demain.',
    'Heute bereits {max} Änderungen: die nächsten morgen.',
    'Ya hay {max} cambios hoy: los siguientes, mañana.',
  ),
  writeRefused_level: m(
    'This message is reserved to the “{level}” access level: Gladys never writes it.',
    'Ce message est réservé au niveau d’accès « {level} » : Gladys ne l’écrit jamais.',
    'Diese Nachricht ist der Zugriffsebene „{level}“ vorbehalten: Gladys schreibt sie nie.',
    'Este mensaje está reservado al nivel de acceso «{level}»: Gladys nunca lo escribe.',
  ),

  // --- Configuration button --------------------------------------------------------------------
  testUnreachable: m(
    'ebusd does not answer at {address} ({error}). Check the address, the port and that ebusd listens on the network (not with --localhost).',
    'ebusd ne répond pas à {address} ({error}). Vérifiez l’adresse, le port et qu’ebusd écoute sur le réseau (pas avec --localhost).',
    'ebusd antwortet nicht unter {address} ({error}). Adresse und Port prüfen, und dass ebusd im Netzwerk lauscht (nicht mit --localhost).',
    'ebusd no responde en {address} ({error}). Compruebe la dirección, el puerto y que ebusd escucha en la red (no con --localhost).',
  ),
  testOk: m(
    'ebusd {version} answers.',
    'ebusd {version} répond.',
    'ebusd {version} antwortet.',
    'ebusd {version} responde.',
  ),
  testSignal: m(
    'The eBUS signal is good.',
    'Le signal eBUS est bon.',
    'Das eBUS-Signal ist gut.',
    'La señal eBUS es buena.',
  ),
  testNoSignal: m(
    'No eBUS signal: check the adapter.',
    'Pas de signal eBUS : vérifiez l’adaptateur.',
    'Kein eBUS-Signal: Adapter prüfen.',
    'Sin señal eBUS: compruebe el adaptador.',
  ),
  testCircuits: m(
    'Devices found (values): {list}.',
    'Appareils trouvés (valeurs) : {list}.',
    'Gefundene Geräte (Werte): {list}.',
    'Dispositivos encontrados (valores): {list}.',
  ),
  testCircuit: m('{name} ({count})', '{name} ({count})', '{name} ({count})', '{name} ({count})'),
  testNoCircuit: m(
    'No eBUS device with values yet: ebusd loads their configuration a few minutes after it sees them; search again later.',
    'Pas encore d’appareil eBUS avec des valeurs : ebusd charge leur configuration quelques minutes après les avoir vus ; relancez la recherche plus tard.',
    'Noch kein eBUS-Gerät mit Werten: ebusd lädt ihre Konfiguration einige Minuten, nachdem es sie sieht; später erneut suchen.',
    'Aún no hay dispositivos eBUS con valores: ebusd carga su configuración unos minutos después de verlos; vuelva a buscar más tarde.',
  ),
  testWritesOn: m(
    'Changes are allowed.',
    'Les modifications sont autorisées.',
    'Änderungen sind erlaubt.',
    'Los cambios están permitidos.',
  ),
  testWritesOff: m('Read only.', 'Lecture seule.', 'Nur lesen.', 'Solo lectura.'),

  // --- Widgets ---------------------------------------------------------------------------------
  widgetOutdoor: m('Outdoor', 'Extérieur', 'Außen', 'Exterior'),
  widgetFlow: m('Flow', 'Départ', 'Vorlauf', 'Impulsión'),
  widgetReturn: m('Return', 'Retour', 'Rücklauf', 'Retorno'),
  widgetRoom: m('Room', 'Ambiance', 'Raum', 'Ambiente'),
  widgetHotWater: m('Hot water', 'Eau chaude', 'Warmwasser', 'Agua caliente'),
  widgetPressure: m('Pressure', 'Pression', 'Druck', 'Presión'),
  widgetModulation: m('Modulation', 'Modulation', 'Modulation', 'Modulación'),
  widgetPower: m('Power', 'Puissance', 'Leistung', 'Potencia'),
  widgetEbusd: m('ebusd', 'ebusd', 'ebusd', 'ebusd'),
  widgetOffline: m('Not answering', 'Ne répond pas', 'Antwortet nicht', 'No responde'),
  widgetNoEbusd: m(
    'ebusd is not reachable yet: check the address in the settings.',
    'ebusd n’est pas joignable pour l’instant : vérifiez l’adresse dans les réglages.',
    'ebusd ist noch nicht erreichbar: Adresse in den Einstellungen prüfen.',
    'ebusd aún no está accesible: compruebe la dirección en los ajustes.',
  ),
  widgetNoCircuit: m(
    'ebusd knows no eBUS device with values yet.',
    'ebusd ne connaît encore aucun appareil eBUS avec des valeurs.',
    'ebusd kennt noch kein eBUS-Gerät mit Werten.',
    'ebusd aún no conoce ningún dispositivo eBUS con valores.',
  ),
  widgetNoValueYet: m(
    'No value yet: add the eBUS devices in Gladys.',
    'Pas encore de valeur : ajoutez les appareils eBUS dans Gladys.',
    'Noch kein Wert: eBUS-Geräte in Gladys hinzufügen.',
    'Aún no hay valores: añada los dispositivos eBUS en Gladys.',
  ),
  widgetAddDevice: m(
    'Add the eBUS devices in Gladys to see their curves.',
    'Ajoutez les appareils eBUS dans Gladys pour voir leurs courbes.',
    'eBUS-Geräte in Gladys hinzufügen, um ihre Kurven zu sehen.',
    'Añada los dispositivos eBUS en Gladys para ver sus curvas.',
  ),
  widgetBus: m('eBUS', 'eBUS', 'eBUS', 'eBUS'),
  widgetNoSignal: m('No signal', 'Pas de signal', 'Kein Signal', 'Sin señal'),
  widgetSignal: m('Signal OK', 'Signal OK', 'Signal OK', 'Señal OK'),
  widgetFlame: m('Flame', 'Flamme', 'Flamme', 'Llama'),
  widgetOn: m('On', 'Allumée', 'An', 'Encendida'),
  widgetOff: m('Off', 'Éteinte', 'Aus', 'Apagada'),
  widgetHeatingMode: m('Heating', 'Chauffage', 'Heizung', 'Calefacción'),
  widgetHotWaterMode: m('Hot water', 'Eau chaude', 'Warmwasser', 'Agua caliente'),
  widgetHotWaterTarget: m(
    'Hot water target',
    'Consigne eau chaude',
    'Warmwasser-Soll',
    'Consigna agua caliente',
  ),
  widgetError: m('Error', 'Erreur', 'Fehler', 'Error'),
  widgetNone: m('None', 'Aucune', 'Keiner', 'Ninguno'),
  widgetTemperatures: m('Temperatures', 'Températures', 'Temperaturen', 'Temperaturas'),
  widgetBusHeading: m('ebusd {version}', 'ebusd {version}', 'ebusd {version}', 'ebusd {version}'),
  widgetSymbolRate: m('Symbols', 'Symboles', 'Symbole', 'Símbolos'),
  widgetMasters: m('Masters', 'Maîtres', 'Master', 'Maestros'),
  widgetMessages: m('Messages', 'Messages', 'Nachrichten', 'Mensajes'),
  widgetConfigLoaded: m('Known', 'Reconnu', 'Erkannt', 'Reconocido'),
  widgetNoConfig: m('Unknown', 'Inconnu', 'Unbekannt', 'Desconocido'),
  widgetLive: m('Live updates', 'Suivi en direct', 'Live-Werte', 'En directo'),
  widgetActive: m('Active', 'Actif', 'Aktiv', 'Activo'),
  widgetInactive: m('Reconnecting', 'Reconnexion', 'Neuverbindung', 'Reconectando'),
};
export function number(value, digits, unit = '') {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const formatted = new Intl.NumberFormat(LOCALES[language], {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        // Spanish skips the separator below 10 000: keep it everywhere.
        useGrouping: 'always',
      }).format(value);
      return [language, unit ? `${formatted}\u00a0${unit}` : formatted];
    }),
  );
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;
