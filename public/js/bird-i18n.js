// DEPRECATED - This file is kept for potential vanilla JS pages. All current pages use bird-vue-core.js for i18n.

/**
 * bird-i18n.js — Moteur de traductions BIRDASH
 *
 * Traductions inline (fr/en/nl) = fallback garanti, toujours disponibles.
 * Fichiers lang/{code}.json = optionnels, chargés en async pour surcharger/étendre.
 * Pour ajouter une langue : créer lang/{code}.json + ajouter le code dans SUPPORTED_LANGS.
 */

// ── Langues supportées ────────────────────────────────────────────────────
const SUPPORTED_LANGS = ['fr', 'en', 'nl'];

// ── Traductions inline (fallback) ─────────────────────────────────────────
const _INLINE = {

  fr: {
    _meta: { lang:'fr', label:'Français', flag:'🇫🇷' },
    nav_overview:'Vue d\'ensemble', nav_detections:'Détections', nav_species:'Espèces',
    nav_biodiversity:'Biodiversité', nav_rarities:'Rarités', nav_stats:'Statistiques',
    nav_system:'Système', nav_analyses:'Analyses',
    today:'Aujourd\'hui', this_week:'Cette semaine', this_month:'Ce mois', all_time:'Total',
    detections:'Détections', species:'Espèces', avg_confidence:'Confiance moy.',
    last_detection:'Dernière détection', top_species:'Top espèces',
    activity_7d:'Activité 7 jours', recent_detections:'Détections récentes',
    no_data:'Aucune donnée', loading:'Chargement…', error:'Erreur',
    date:'Date', time:'Heure', species_name:'Espèce', scientific_name:'Nom scientifique',
    confidence:'Confiance', audio:'Audio', play:'Écouter',
    filter_species:'Filtrer par espèce', filter_date_from:'Du', filter_date_to:'Au',
    filter_confidence:'Confiance min.', all_species:'Toutes espèces',
    apply_filter:'Appliquer', reset_filter:'Réinitialiser',
    prev_page:'← Précédent', next_page:'Suivant →', page:'Page', of:'sur', results:'résultats',
    species_detail:'Fiche espèce', first_detection:'Première détection', last_seen:'Dernière fois',
    total_detections:'Total détections', max_confidence:'Confiance max.',
    activity_by_hour:'Activité par heure', monthly_presence:'Présence mensuelle',
    external_links:'Liens externes', listen_on:'Écouter sur', observe_on:'Observer sur',
    species_x_month:'Espèces par mois', richness_per_day:'Richesse journalière',
    heatmap_hour_day:'Activité heure × jour',
    rare_species:'Espèces rares', rare_desc:'Espèces avec moins de {n} détections',
    first_seen:'Vue la première fois', detections_count:'Nb détections',
    top_by_count:'Classement par détections', top_by_confidence:'Classement par confiance',
    confidence_distrib:'Distribution confiance', activity_calendar:'Calendrier d\'activité',
    monthly_totals:'Totaux mensuels',
    db_status:'État base de données', db_size:'Taille DB', db_total:'Total enregistrements',
    db_first:'Première détection', db_last:'Dernière détection',
    service_status:'État du service', api_ok:'API opérationnelle', api_error:'API hors ligne',
    data_freshness:'Fraîcheur données',
    minutes_ago:'il y a {n} min', hours_ago:'il y a {n}h', days_ago:'il y a {n}j',
    months_short:['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'],
    months_long:['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
    days_short:['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'],
    // Analyses
    analyses_period:'Explorer pour la période {from} → {to}',
    analyses_what_species:'Quelle espèce explorer ?',
    analyses_loading_ph:'— chargement… —', analyses_no_species:'— aucune espèce —',
    analyses_topn_label:'Top', analyses_topn_unit:'espèces',
    analyses_topn_btn:'Sélectionner', analyses_clear_btn:'✕ Tout désélectionner',
    analyses_search_ph:'🔍  Filtrer les espèces…',
    analyses_n_selected:'{n} espèce(s) sélectionnée(s)', analyses_n_total:'{n} espèce(s) au total',
    analyses_kpi_raw:'Détections brutes', analyses_kpi_resampled:'Après rééchantillonnage',
    analyses_kpi_conf:'Confiance moyenne', analyses_kpi_days:'Jours détectée', analyses_kpi_avg_day:'Moy. / jour',
    analyses_polar_title:'Activité horaire · {species}',
    analyses_series_title:'Détections dans le temps · {species}',
    analyses_heatmap_title:'Heatmap journalière · {species}',
    analyses_multi_polar:'Activité horaire · {species} (principale)',
    analyses_multi_series:'Comparaison {n} espèces',
    analyses_no_data_period:'Aucune donnée pour cette période.',
    analyses_tooltip_det:'{n} détections · {pct}% de la journée',
    analyses_resample_raw:'Brut', analyses_resample_15:'15 min',
    analyses_resample_1h:'Horaire', analyses_resample_1d:'Journalier',
    analyses_conf_label:'Confiance min.', analyses_date_from:'Du', analyses_date_to:'Au',
    analyses_quick_7d:'7j', analyses_quick_30d:'30j', analyses_quick_90d:'90j',
    analyses_quick_1y:'1 an', analyses_quick_all:'Tout',
    // Narratif
    narr_no_data:'Aucune donnée pour cette période.',
    narr_period:'Sur la période {from} → {to},',
    narr_habit_morning:'matinal', narr_habit_midday:'actif en milieu de journée',
    narr_habit_afternoon:'actif en fin d\'après-midi',
    narr_habit_night:'nocturne ou crépusculaire', narr_habit_day:'actif dans la journée',
    narr_is:'est', narr_peak_at:'Son pic d\'activité se situe à {time}, représentant {pct}% des détections.',
    narr_activity_range:'L\'activité démarre vers {start} et se termine vers {end}, soit environ {duration}.',
    narr_duration:'{n}h d\'activité', narr_duration_short:'activité concentrée',
    narr_second_peak:'Un second pic notable apparaît vers {time}.',
    narr_night_pct:'{pct}% des détections se produisent entre 21h et 5h du matin.',
    narr_total:'Total : {n} détections sur {h} heures actives.',
    narr_multi_intro:'{n} espèces sélectionnées. Espèce principale : {species}.',
    narr_multi_hint:'Le rose chart et la heatmap affichent les données de {species}. La série temporelle compare toutes les espèces.',
    // Système
    sys_api_label:'API bird-server', sys_latency:'Latence', sys_port:'Port',
    sys_species_distinct:'Espèces distinctes', sys_days_recorded:'Jours enregistrés',
    sys_conf_range:'Confiance moy. / min / max', sys_last_det:'Dernière détection',
    sys_date_time:'Date / Heure', sys_det_today:'Détections aujourd\'hui',
    sys_det_yesterday:'Détections hier', sys_no_gap:'✓ Aucun gap détecté',
    sys_no_gap_full:'✓ Aucun gap — données continues',
    sys_gaps_found:'{n} gap(s) détecté(s) au total', sys_gap_missing:'{n} jour(s) manquant(s)',
    sys_gaps_title:'⚠️ Jours sans données (> {n} jour de gap)',
    sys_activity_30d:'📈 Activité quotidienne — 30 derniers jours',
    sys_hourly_distrib:'🕐 Distribution horaire globale',
    // Rarités / Stats
    rarity_threshold_label:'Seuil rarité (max détections)',
    rarity_seen_once:'💎 Vues une seule fois', rarity_last_rare:'🕐 Dernières détections rares',
    latin_name:'Nom latin', bio_total:'Total', kpi_days_detected:'Jours détectée',
    stats_daily_records:'🏆 Records journaliers', stats_annual_evolution:'📅 Évolution annuelle',
    stats_record_most_det:'Jour avec le + de détections',
    stats_record_most_sp:'Jour avec le + d\'espèces', stats_record_max_conf:'Confiance maximale',
  },

  en: {
    _meta: { lang:'en', label:'English', flag:'🇬🇧' },
    nav_overview:'Overview', nav_detections:'Detections', nav_species:'Species',
    nav_biodiversity:'Biodiversity', nav_rarities:'Rarities', nav_stats:'Statistics',
    nav_system:'System', nav_analyses:'Analysis',
    today:'Today', this_week:'This week', this_month:'This month', all_time:'All time',
    detections:'Detections', species:'Species', avg_confidence:'Avg confidence',
    last_detection:'Last detection', top_species:'Top species',
    activity_7d:'7-day activity', recent_detections:'Recent detections',
    no_data:'No data', loading:'Loading…', error:'Error',
    date:'Date', time:'Time', species_name:'Species', scientific_name:'Scientific name',
    confidence:'Confidence', audio:'Audio', play:'Play',
    filter_species:'Filter by species', filter_date_from:'From', filter_date_to:'To',
    filter_confidence:'Min. confidence', all_species:'All species',
    apply_filter:'Apply', reset_filter:'Reset',
    prev_page:'← Previous', next_page:'Next →', page:'Page', of:'of', results:'results',
    species_detail:'Species detail', first_detection:'First detected', last_seen:'Last seen',
    total_detections:'Total detections', max_confidence:'Max confidence',
    activity_by_hour:'Hourly activity', monthly_presence:'Monthly presence',
    external_links:'External links', listen_on:'Listen on', observe_on:'Observe on',
    species_x_month:'Species by month', richness_per_day:'Daily richness',
    heatmap_hour_day:'Activity hour × day',
    rare_species:'Rare species', rare_desc:'Species with fewer than {n} detections',
    first_seen:'First seen', detections_count:'Detections',
    top_by_count:'Ranking by detections', top_by_confidence:'Ranking by confidence',
    confidence_distrib:'Confidence distribution', activity_calendar:'Activity calendar',
    monthly_totals:'Monthly totals',
    db_status:'Database status', db_size:'DB size', db_total:'Total records',
    db_first:'First detection', db_last:'Last detection',
    service_status:'Service status', api_ok:'API running', api_error:'API offline',
    data_freshness:'Data freshness',
    minutes_ago:'{n} min ago', hours_ago:'{n}h ago', days_ago:'{n}d ago',
    months_short:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    months_long:['January','February','March','April','May','June','July','August','September','October','November','December'],
    days_short:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    analyses_period:'Exploring period {from} → {to}',
    analyses_what_species:'Which species to explore?',
    analyses_loading_ph:'— loading… —', analyses_no_species:'— no species —',
    analyses_topn_label:'Top', analyses_topn_unit:'species',
    analyses_topn_btn:'Select', analyses_clear_btn:'✕ Clear all',
    analyses_search_ph:'🔍  Filter species…',
    analyses_n_selected:'{n} species selected', analyses_n_total:'{n} species total',
    analyses_kpi_raw:'Raw detections', analyses_kpi_resampled:'After resampling',
    analyses_kpi_conf:'Avg confidence', analyses_kpi_days:'Days detected', analyses_kpi_avg_day:'Avg / day',
    analyses_polar_title:'Hourly activity · {species}',
    analyses_series_title:'Detections over time · {species}',
    analyses_heatmap_title:'Daily heatmap · {species}',
    analyses_multi_polar:'Hourly activity · {species} (primary)',
    analyses_multi_series:'Comparing {n} species',
    analyses_no_data_period:'No data for this period.',
    analyses_tooltip_det:'{n} detections · {pct}% of the day',
    analyses_resample_raw:'Raw', analyses_resample_15:'15 min',
    analyses_resample_1h:'Hourly', analyses_resample_1d:'Daily',
    analyses_conf_label:'Min. confidence', analyses_date_from:'From', analyses_date_to:'To',
    analyses_quick_7d:'7d', analyses_quick_30d:'30d', analyses_quick_90d:'90d',
    analyses_quick_1y:'1yr', analyses_quick_all:'All',
    narr_no_data:'No data for this period.',
    narr_period:'Over the period {from} → {to},',
    narr_habit_morning:'a morning bird', narr_habit_midday:'most active around midday',
    narr_habit_afternoon:'most active in the afternoon',
    narr_habit_night:'nocturnal or crepuscular', narr_habit_day:'active during the day',
    narr_is:'is', narr_peak_at:'Peak activity at {time}, representing {pct}% of daily detections.',
    narr_activity_range:'Activity starts around {start} and ends around {end}, spanning {duration}.',
    narr_duration:'{n}h of activity', narr_duration_short:'concentrated activity',
    narr_second_peak:'A second notable peak appears around {time}.',
    narr_night_pct:'{pct}% of detections occur between 9pm and 5am.',
    narr_total:'Total: {n} detections over {h} active hours.',
    narr_multi_intro:'{n} species selected. Primary species: {species}.',
    narr_multi_hint:'The rose chart and heatmap show data for {species}. The time series compares all species.',
    sys_api_label:'API bird-server', sys_latency:'Latency', sys_port:'Port',
    sys_species_distinct:'Distinct species', sys_days_recorded:'Days recorded',
    sys_conf_range:'Confidence avg / min / max', sys_last_det:'Last detection',
    sys_date_time:'Date / Time', sys_det_today:'Detections today',
    sys_det_yesterday:'Detections yesterday', sys_no_gap:'✓ No gaps detected',
    sys_no_gap_full:'✓ No gaps — continuous data',
    sys_gaps_found:'{n} gap(s) detected in total', sys_gap_missing:'{n} missing day(s)',
    sys_gaps_title:'⚠️ Days without data (> {n} day gap)',
    sys_activity_30d:'📈 Daily activity — last 30 days',
    sys_hourly_distrib:'🕐 Global hourly distribution',
    rarity_threshold_label:'Rarity threshold (max detections)',
    rarity_seen_once:'💎 Seen only once', rarity_last_rare:'🕐 Latest rare detections',
    latin_name:'Latin name', bio_total:'Total', kpi_days_detected:'Days detected',
    stats_daily_records:'🏆 Daily records', stats_annual_evolution:'📅 Annual evolution',
    stats_record_most_det:'Day with most detections',
    stats_record_most_sp:'Day with most species', stats_record_max_conf:'Maximum confidence',
  },

  nl: {
    _meta: { lang:'nl', label:'Nederlands', flag:'🇳🇱' },
    nav_overview:'Overzicht', nav_detections:'Detecties', nav_species:'Soorten',
    nav_biodiversity:'Biodiversiteit', nav_rarities:'Zeldzaamheden',
    nav_stats:'Statistieken', nav_system:'Systeem', nav_analyses:'Analyse',
    today:'Vandaag', this_week:'Deze week', this_month:'Deze maand', all_time:'Totaal',
    detections:'Detecties', species:'Soorten', avg_confidence:'Gem. betrouwbaarheid',
    last_detection:'Laatste detectie', top_species:'Top soorten',
    activity_7d:'7-daagse activiteit', recent_detections:'Recente detecties',
    no_data:'Geen gegevens', loading:'Laden…', error:'Fout',
    date:'Datum', time:'Tijd', species_name:'Soort', scientific_name:'Wetenschappelijke naam',
    confidence:'Betrouwbaarheid', audio:'Audio', play:'Afspelen',
    filter_species:'Filter op soort', filter_date_from:'Van', filter_date_to:'Tot',
    filter_confidence:'Min. betrouwbaarheid', all_species:'Alle soorten',
    apply_filter:'Toepassen', reset_filter:'Resetten',
    prev_page:'← Vorige', next_page:'Volgende →', page:'Pagina', of:'van', results:'resultaten',
    species_detail:'Soortinfo', first_detection:'Eerste detectie', last_seen:'Laatst gezien',
    total_detections:'Totaal detecties', max_confidence:'Max. betrouwbaarheid',
    activity_by_hour:'Activiteit per uur', monthly_presence:'Maandelijkse aanwezigheid',
    external_links:'Externe links', listen_on:'Beluisteren op', observe_on:'Observeren op',
    species_x_month:'Soorten per maand', richness_per_day:'Dagelijkse rijkdom',
    heatmap_hour_day:'Activiteit uur × dag',
    rare_species:'Zeldzame soorten', rare_desc:'Soorten met minder dan {n} detecties',
    first_seen:'Eerst gezien', detections_count:'Detecties',
    top_by_count:'Ranglijst op detecties', top_by_confidence:'Ranglijst op betrouwbaarheid',
    confidence_distrib:'Betrouwbaarheidsverdeling', activity_calendar:'Activiteitskalender',
    monthly_totals:'Maandtotalen',
    db_status:'Databasestatus', db_size:'DB-grootte', db_total:'Totaal records',
    db_first:'Eerste detectie', db_last:'Laatste detectie',
    service_status:'Servicestatus', api_ok:'API actief', api_error:'API offline',
    data_freshness:'Gegevensversheid',
    minutes_ago:'{n} min geleden', hours_ago:'{n}u geleden', days_ago:'{n}d geleden',
    months_short:['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'],
    months_long:['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'],
    days_short:['Maa','Din','Woe','Don','Vri','Zat','Zon'],
    analyses_period:'Verkenning voor periode {from} → {to}',
    analyses_what_species:'Welke soort verkennen?',
    analyses_loading_ph:'— laden… —', analyses_no_species:'— geen soort —',
    analyses_topn_label:'Top', analyses_topn_unit:'soorten',
    analyses_topn_btn:'Selecteren', analyses_clear_btn:'✕ Alles wissen',
    analyses_search_ph:'🔍  Soorten filteren…',
    analyses_n_selected:'{n} soort(en) geselecteerd', analyses_n_total:'{n} soorten totaal',
    analyses_kpi_raw:'Ruwe detecties', analyses_kpi_resampled:'Na hersampling',
    analyses_kpi_conf:'Gem. betrouwbaarheid', analyses_kpi_days:'Dagen gedetecteerd', analyses_kpi_avg_day:'Gem. / dag',
    analyses_polar_title:'Uuractiviteit · {species}',
    analyses_series_title:'Detecties in de tijd · {species}',
    analyses_heatmap_title:'Dagelijkse heatmap · {species}',
    analyses_multi_polar:'Uuractiviteit · {species} (hoofdsoort)',
    analyses_multi_series:'{n} soorten vergelijken',
    analyses_no_data_period:'Geen gegevens voor deze periode.',
    analyses_tooltip_det:'{n} detecties · {pct}% van de dag',
    analyses_resample_raw:'Ruw', analyses_resample_15:'15 min',
    analyses_resample_1h:'Uurlijks', analyses_resample_1d:'Dagelijks',
    analyses_conf_label:'Min. betrouwbaarheid', analyses_date_from:'Van', analyses_date_to:'Tot',
    analyses_quick_7d:'7d', analyses_quick_30d:'30d', analyses_quick_90d:'90d',
    analyses_quick_1y:'1jr', analyses_quick_all:'Alles',
    narr_no_data:'Geen gegevens voor deze periode.',
    narr_period:'Over de periode {from} → {to},',
    narr_habit_morning:'een ochtendvogel', narr_habit_midday:'meest actief rond het middaguur',
    narr_habit_afternoon:'meest actief in de namiddag',
    narr_habit_night:'nachtelijk of schemervogel', narr_habit_day:'actief overdag',
    narr_is:'is', narr_peak_at:'Piekactiviteit om {time}, goed voor {pct}% van de dagelijkse detecties.',
    narr_activity_range:'Activiteit begint rond {start} en eindigt rond {end}, gedurende {duration}.',
    narr_duration:'{n}u activiteit', narr_duration_short:'geconcentreerde activiteit',
    narr_second_peak:'Een tweede piek verschijnt rond {time}.',
    narr_night_pct:'{pct}% van de detecties vindt plaats tussen 21u en 5u.',
    narr_total:'Totaal: {n} detecties over {h} actieve uren.',
    narr_multi_intro:'{n} soorten geselecteerd. Hoofdsoort: {species}.',
    narr_multi_hint:'De rozenkaart en heatmap tonen gegevens van {species}. De tijdreeks vergelijkt alle soorten.',
    sys_api_label:'API bird-server', sys_latency:'Latentie', sys_port:'Poort',
    sys_species_distinct:'Distincte soorten', sys_days_recorded:'Opgenomen dagen',
    sys_conf_range:'Betrouwbaarheid gem. / min / max', sys_last_det:'Laatste detectie',
    sys_date_time:'Datum / Tijd', sys_det_today:'Detecties vandaag',
    sys_det_yesterday:'Detecties gisteren', sys_no_gap:'✓ Geen gaten gedetecteerd',
    sys_no_gap_full:'✓ Geen gaten — continue gegevens',
    sys_gaps_found:'{n} gat(en) gedetecteerd in totaal', sys_gap_missing:'{n} ontbrekende dag(en)',
    sys_gaps_title:'⚠️ Dagen zonder gegevens (> {n} dag)',
    sys_activity_30d:'📈 Dagelijkse activiteit — laatste 30 dagen',
    sys_hourly_distrib:'🕐 Globale uurverdeling',
    rarity_threshold_label:'Zeldzaamheidsdrempel (max detecties)',
    rarity_seen_once:'💎 Slechts één keer gezien', rarity_last_rare:'🕐 Laatste zeldzame detecties',
    latin_name:'Latijnse naam', bio_total:'Totaal', kpi_days_detected:'Dagen gedetecteerd',
    stats_daily_records:'🏆 Dagelijkse records', stats_annual_evolution:'📅 Jaarlijkse evolutie',
    stats_record_most_det:'Dag met meeste detecties',
    stats_record_most_sp:'Dag met meeste soorten', stats_record_max_conf:'Maximale betrouwbaarheid',
  },
};

// ── État ──────────────────────────────────────────────────────────────────
let _currentLang  = 'fr';
let _translations = {};   // copie de _INLINE, éventuellement surchargée par JSON
let _i18nReady    = false;

// ── Chargement ────────────────────────────────────────────────────────────
async function loadTranslations() {
  // Démarrer avec les traductions inline — toujours disponibles
  SUPPORTED_LANGS.forEach(lang => {
    _translations[lang] = Object.assign({}, _INLINE[lang]);
  });

  // Tenter de surcharger/étendre depuis les fichiers JSON (optionnel)
  const base = window.location.pathname.replace(/[^/]*$/, '');
  await Promise.allSettled(
    SUPPORTED_LANGS.map(async lang => {
      try {
        const res = await fetch(`${base}i18n/${lang}.json`);
        if (!res.ok) return;
        const data = await res.json();
        // Fusionner : JSON a priorité sur inline sauf pour _meta
        _translations[lang] = Object.assign({}, _INLINE[lang], data);
      } catch (_) { /* silencieux — inline utilisé */ }
    })
  );

  // Restaurer préférence de langue
  const saved = localStorage.getItem('birdash_lang');
  _currentLang = (saved && _translations[saved]) ? saved
    : (typeof BIRD_CONFIG !== 'undefined' && BIRD_CONFIG.defaultLang
       && _translations[BIRD_CONFIG.defaultLang]) ? BIRD_CONFIG.defaultLang
    : 'fr';

  _i18nReady = true;
  return _translations;
}

// ── t() ───────────────────────────────────────────────────────────────────
function t(key, vars = {}) {
  const dict = _translations[_currentLang] || _translations['fr'] || _INLINE['fr'];
  const fr   = _translations['fr'] || _INLINE['fr'];
  let val = dict[key] !== undefined ? dict[key]
          : fr[key]   !== undefined ? fr[key]
          : key;
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && Object.keys(vars).length) {
    Object.entries(vars).forEach(([k, v]) => {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    });
  }
  return val;
}

function getAvailableLangs() {
  return SUPPORTED_LANGS.map(code => ({
    code,
    label: (_translations[code]?._meta?.label) || (_INLINE[code]?._meta?.label) || code.toUpperCase(),
    flag:  (_translations[code]?._meta?.flag)  || (_INLINE[code]?._meta?.flag)  || '',
  }));
}

function getLang()     { return _currentLang; }
function isI18nReady() { return _i18nReady; }

function setLang(lang) {
  if (!_translations[lang] && !_INLINE[lang]) return;
  _currentLang = lang;
  localStorage.setItem('birdash_lang', lang);
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

function initI18nDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}
