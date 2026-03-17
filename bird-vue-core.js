/**
 * bird-vue-core.js — Composables partagés PIBIRD (Vue 3 CDN)
 *
 * Dépend de : Vue 3 (CDN global), bird-config.js
 * Remplace  : bird-i18n.js + bird-core.js pour les pages migrées
 *
 * Expose via window :
 *   useI18n()        → { lang, t, setLang, langs }
 *   useTheme()       → { theme, themes, setTheme }
 *   useNav(pageId)   → { navItems }  (computed, réactif à lang)
 *   birdQuery(sql, params)
 *   fmtDate / fmtTime / fmtConf / localDateStr / daysAgo / freshnessLabel
 *   buildAudioUrl / useAudio()
 *   buildSpeciesLinks / fetchSpeciesImage
 *   getUrlParam / navigateTo
 *   chartDefaults()
 */

;(function (Vue, BIRD_CONFIG) {
  'use strict';

  // ── Service Worker ────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const { ref, computed, watch, onUnmounted } = Vue;

  // ── Traductions inline ────────────────────────────────────────────────────
  // Même contenu que bird-i18n.js — pas de fetch, disponible immédiatement.
  const _TRANSLATIONS = {
    fr: {
      _meta: { lang:'fr', label:'Français', flag:'🇫🇷' },
      nav_overview:'Vue d\'ensemble', nav_today:'Aujourd\'hui', nav_recent:'Récent',
      nav_detections:'Détections', nav_species:'Espèces',
      nav_biodiversity:'Biodiversité', nav_rarities:'Rarités', nav_stats:'Statistiques',
      nav_system:'Système', nav_analyses:'Analyses', nav_spectrogram:'Spectrogramme', nav_recordings:'Enregistrements',
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
      analyses_period:'Explorer pour la période {from} → {to}',
      analyses_what_species:'Quelle espèce explorer ?',
      analyses_loading_ph:'— chargement… —', analyses_no_species:'— aucune espèce —',
      analyses_topn_label:'Top', analyses_topn_unit:'espèces',
      analyses_topn_btn:'Sélectionner', analyses_clear_btn:'✕ Tout désélectionner',
      analyses_search_ph:'🔍  Filtrer les espèces…',
      analyses_n_selected:'{n} espèce(s) sélectionnée(s)', analyses_n_total:'{n} espèce(s) au total',
      analyses_kpi_raw:'Détections brutes', analyses_kpi_resampled:'Après rééchantillonnage',
      analyses_kpi_conf:'Confiance moyenne', analyses_kpi_days:'Jours détectée',
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
      rarity_threshold_label:'Seuil rarité (max détections)',
      rarity_seen_once:'💎 Vues une seule fois', rarity_last_rare:'🕐 Dernières détections rares',
      latin_name:'Nom latin', bio_total:'Total', kpi_days_detected:'Jours détectée',
      stats_daily_records:'🏆 Records journaliers', stats_annual_evolution:'📅 Évolution annuelle',
      stats_record_most_det:'Jour avec le + de détections',
      stats_record_most_sp:'Jour avec le + d\'espèces', stats_record_max_conf:'Confiance maximale',
    },

    en: {
      _meta: { lang:'en', label:'English', flag:'🇬🇧' },
      nav_overview:'Overview', nav_today:'Today', nav_recent:'Recent',
      nav_detections:'Detections', nav_species:'Species',
      nav_biodiversity:'Biodiversity', nav_rarities:'Rarities', nav_stats:'Statistics',
      nav_system:'System', nav_analyses:'Analysis', nav_spectrogram:'Spectrogram', nav_recordings:'Recordings',
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
      analyses_kpi_conf:'Avg confidence', analyses_kpi_days:'Days detected',
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
      nav_overview:'Overzicht', nav_today:'Vandaag', nav_recent:'Recent',
      nav_detections:'Detecties', nav_species:'Soorten',
      nav_biodiversity:'Biodiversiteit', nav_rarities:'Zeldzaamheden',
      nav_stats:'Statistieken', nav_system:'Systeem', nav_analyses:'Analyse', nav_spectrogram:'Spectrogram', nav_recordings:'Opnames',
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
      analyses_kpi_conf:'Gem. betrouwbaarheid', analyses_kpi_days:'Dagen gedetecteerd',
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

  // ── Singletons réactifs (partagés dans toute l'app) ───────────────────────
  // Un seul ref par page — Vue garantit que tous les composables qui y accèdent
  // voient le même changement et réagissent de façon coordonnée.
  const _lang  = ref(localStorage.getItem('pibird_lang')  || 'fr');
  const _theme = ref(localStorage.getItem('pibird-theme') || 'forest');

  // Appliquer le thème immédiatement au chargement
  document.documentElement.setAttribute('data-theme', _theme.value);

  // ── useI18n ───────────────────────────────────────────────────────────────
  function useI18n() {
    /**
     * t(key, vars) — traduit une clé.
     * C'est une fonction régulière qui lit `_lang.value` — Vue détecte cette
     * dépendance dans tout `computed()` ou expression de template qui l'appelle.
     * Aucun addEventListener('langchange') nécessaire.
     */
    function t(key, vars = {}) {
      const dict = _TRANSLATIONS[_lang.value] || _TRANSLATIONS['fr'];
      const fb   = _TRANSLATIONS['fr'];
      let val = dict[key] !== undefined ? dict[key]
              : fb[key]   !== undefined ? fb[key]
              : key;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && Object.keys(vars).length) {
        Object.entries(vars).forEach(([k, v]) => {
          val = val.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
        });
      }
      return val;
    }

    function setLang(code) {
      if (!_TRANSLATIONS[code]) return;
      _lang.value = code;
      localStorage.setItem('pibird_lang', code);
    }

    const langs = Object.keys(_TRANSLATIONS).map(code => ({
      code,
      label: _TRANSLATIONS[code]._meta.label,
      flag:  _TRANSLATIONS[code]._meta.flag,
    }));

    return { lang: _lang, t, setLang, langs };
  }

  // ── useTheme ──────────────────────────────────────────────────────────────
  const THEMES = [
    { id:'forest', label:'Forest',  colors:['#34d399','#0f1418'] },
    { id:'night',  label:'Night',   colors:['#a78bfa','#0e1018'] },
    { id:'paper',  label:'Paper',   colors:['#0d9488','#faf8f4'] },
    { id:'ocean',  label:'Ocean',   colors:['#22d3ee','#0a1220'] },
    { id:'dusk',   label:'Dusk',    colors:['#f472b6','#161218'] },
  ];

  function useTheme() {
    function setTheme(id) {
      _theme.value = id;
      localStorage.setItem('pibird-theme', id);
      document.documentElement.setAttribute('data-theme', id);
    }
    return { theme: _theme, themes: THEMES, setTheme };
  }

  // ── useNav ────────────────────────────────────────────────────────────────
  const NAV_KEYS = {
    index:        'nav_overview',
    today:        'nav_today',
    recent:       'nav_recent',
    detections:   'nav_detections',
    species:      'nav_species',
    biodiversity: 'nav_biodiversity',
    rarities:     'nav_rarities',
    stats:        'nav_stats',
    analyses:     'nav_analyses',
    spectrogram:  'nav_spectrogram',
    recordings:   'nav_recordings',
    system:       'nav_system',
  };

  function useNav(pageId) {
    const { t } = useI18n();
    const navItems = computed(() =>
      BIRD_CONFIG.pages.map(p => ({
        ...p,
        label:  t(NAV_KEYS[p.id] || p.id),
        active: p.id === pageId,
      }))
    );
    // siteName exposé pour le template header-brand (BIRD_CONFIG non accessible directement dans Vue 3)
    const siteName = BIRD_CONFIG.siteName
      || (BIRD_CONFIG.location && BIRD_CONFIG.location.name)
      || '';
    return { navItems, siteName };
  }

  // ── useChart ──────────────────────────────────────────────────────────────
  /**
   * Wrapper Chart.js avec gestion automatique du destroy.
   * Usage dans setup() :
   *   const { mountChart } = useChart();
   *   watch(data, () => mountChart(canvasRef, config));
   */
  function useChart() {
    let _instance = null;

    function mountChart(canvasRef, configFn) {
      if (!canvasRef.value) return;
      if (_instance) { _instance.destroy(); _instance = null; }
      const ctx = canvasRef.value.getContext('2d');
      _instance = new Chart(ctx, configFn());
    }

    // Cleanup auto si le composant est démonté
    onUnmounted(() => { if (_instance) { _instance.destroy(); _instance = null; } });

    return { mountChart };
  }

  // ── Échappement HTML (anti-XSS pour v-html) ──────────────────────────────
  function escHtml(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Utilitaires purs (non réactifs) ───────────────────────────────────────

  async function birdQuery(sql, params = []) {
    const res = await fetch(`${BIRD_CONFIG.apiUrl}/query`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sql, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.rows.map(row => {
      const obj = {};
      data.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function fmtTime(timeStr) {
    if (!timeStr) return '—';
    return timeStr.substring(0, 5);
  }

  function fmtConf(val) {
    if (val == null) return '—';
    return (parseFloat(val) * 100).toFixed(1) + '%';
  }

  function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return localDateStr(d);
  }

  // freshnessLabel dépend de t() — prend t en paramètre pour rester pur
  function freshnessLabel(dateStr, timeStr, t) {
    if (!dateStr || !timeStr) return '—';
    const last = new Date(`${dateStr}T${timeStr}`);
    const diffMs  = Date.now() - last.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60)   return t('minutes_ago', { n: diffMin });
    if (diffMin < 1440) return t('hours_ago',   { n: Math.floor(diffMin / 60) });
    return t('days_ago', { n: Math.floor(diffMin / 1440) });
  }

  function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function navigateTo(page, params = {}) {
    const qs = new URLSearchParams(params).toString();
    window.location.href = `${page}${qs ? '?' + qs : ''}`;
  }

  function buildAudioUrl(fileName) {
    if (!fileName) return null;
    const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
    if (!m) return null;
    return `${BIRD_CONFIG.audioUrl}/By_Date/${m[2]}/${m[1]}/${encodeURIComponent(fileName)}`;
  }

  function buildSpeciesLinks(comName, sciName) {
    const sci     = encodeURIComponent(sciName || '');
    const com     = encodeURIComponent(comName || '');
    const sciWiki = (sciName || '').replace(/ /g, '_');
    return {
      xenocanto:   { url:`https://xeno-canto.org/explore?query=${sci}`,          label:'Xeno-canto',    icon:'🎵' },
      ebird:       { url:`https://ebird.org/search?q=${sci}`,                    label:'eBird',         icon:'🌍' },
      wikipedia:   { url:`https://fr.wikipedia.org/wiki/${sciWiki}`,             label:'Wikipédia',     icon:'📖' },
      inaturalist: { url:`https://www.inaturalist.org/taxa/search?q=${sci}`,     label:'iNaturalist',   icon:'🔬' },
      observation: { url:`https://observation.be/species/default.aspx?name=${com}`,label:'Observation.be',icon:'🐦'},
      avibase:     { url:`https://avibase.bsc-eoc.org/search.jsp?query=${sci}`,  label:'Avibase',       icon:'📋' },
    };
  }

  async function fetchSpeciesImage(sciName) {
    if (!sciName) return null;
    const title = sciName.replace(/ /g, '_');
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.thumbnail?.source || null;
    } catch { return null; }
  }

  // ── useAudio ──────────────────────────────────────────────────────────────
  function useAudio() {
    let _current = null;
    const playingFile = ref(null);

    function toggleAudio(fileName) {
      const url = buildAudioUrl(fileName);
      if (!url) return;

      if (_current && playingFile.value === fileName) {
        _current.pause();
        _current = null;
        playingFile.value = null;
        return;
      }

      if (_current) { _current.pause(); _current = null; }

      const audio = new Audio(url);
      _current = audio;
      playingFile.value = fileName;

      audio.play().catch(() => { playingFile.value = null; _current = null; });
      audio.addEventListener('ended', () => { playingFile.value = null; _current = null; });
    }

    onUnmounted(() => { if (_current) { _current.pause(); _current = null; } });

    return { playingFile, toggleAudio };
  }

  // ── fetchCachedPhoto — cache localStorage + /api/photo + fallbacks ───────────
  // Utilisable depuis toutes les pages. TTL 30 jours.
  const PHOTO_TTL = 30 * 24 * 3600 * 1000;
  const PHOTO_LS_PREFIX = 'pibird_photo_';

  async function fetchCachedPhoto(sciName) {
    if (!sciName) return null;

    // 1. localStorage — vérifier TTL
    const lsKey = PHOTO_LS_PREFIX + sciName.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const cached = JSON.parse(localStorage.getItem(lsKey));
      if (cached && cached.url && (Date.now() - cached.ts < PHOTO_TTL)) {
        return cached.url;
      }
    } catch(e) {}

    let url = null;

    // 2. /api/photo (cache disque serveur)
    try {
      const apiUrl = BIRD_CONFIG.apiUrl + '/photo?sci=' + encodeURIComponent(sciName);
      const res = await fetch(apiUrl);
      if (res.ok) url = apiUrl;
    } catch(e) {}

    // 3. iNaturalist direct (si serveur indisponible)
    if (!url) {
      try {
        const tn  = encodeURIComponent(sciName);
        const res = await fetch(
          `https://api.inaturalist.org/v1/taxa?taxon_name=${tn}&rank=species&per_page=3`
        );
        if (res.ok) {
          const data  = await res.json();
          const taxon = data.results?.find(t =>
            t.name.toLowerCase() === sciName.toLowerCase()
          );
          url = taxon?.default_photo?.medium_url
             || taxon?.default_photo?.square_url
             || taxon?.default_photo?.url
             || null;
        }
      } catch(e) {}
    }

    // 4. Wikipedia direct
    if (!url) {
      try {
        const title = sciName.replace(/ /g, '_');
        const res   = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
        );
        if (res.ok) {
          const data = await res.json();
          url = data.thumbnail?.source || null;
        }
      } catch(e) {}
    }

    // Stocker en localStorage (même null → évite de re-fetcher inutilement)
    try {
      localStorage.setItem(lsKey, JSON.stringify({ url, ts: Date.now() }));
    } catch(e) {}

    return url;
  }

  // ── Chart.js defaults ─────────────────────────────────────────────────────
  function chartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#7a9b7d', font: { family: 'Lora' } } },
        tooltip: {
          backgroundColor: '#131f14', borderColor: '#2d4a2f', borderWidth: 1,
          titleColor: '#e8f0e9', bodyColor: '#7a9b7d',
        },
      },
      scales: {
        x: { ticks: { color: '#7a9b7d' }, grid: { color: '#1a2b1c' } },
        y: { ticks: { color: '#7a9b7d' }, grid: { color: '#1a2b1c' } },
      },
    };
  }

  // ── Composant PibirdShell ─────────────────────────────────────────────────
  // Encapsule le header, la navigation, les switchers thème/langue et le <main>.
  // Usage : <pibird-shell page="species"> … contenu … </pibird-shell>
  const PibirdShell = {
    props: { page: { type: String, default: '' } },
    setup(props) {
      const { lang, t, setLang, langs } = useI18n();
      const { theme, themes, setTheme } = useTheme();
      const { navItems, siteName }      = useNav(props.page);
      return { lang, t, setLang, langs, theme, themes, setTheme, navItems, siteName };
    },
    template: `
<div class="app-shell">
  <a href="#pibird-main" class="skip-link">Aller au contenu</a>
  <header class="app-header" role="banner">
    <div class="header-brand">
      <img src="robin-logo.svg" class="brand-logo" alt="PIBIRD Robin">
      <div class="brand-text">
        <span class="brand-name">PIBIRD</span>
        <span class="brand-sub">{{siteName}}</span>
      </div>
    </div>
    <div class="header-right">
      <div class="theme-switcher-wrap">
        <button v-for="th in themes" :key="th.id" class="theme-btn"
                :class="{active:theme===th.id}" :data-t="th.id" :title="th.label"
                :aria-label="th.label" @click="setTheme(th.id)"></button>
      </div>
      <div class="lang-switcher-wrap">
        <button v-for="l in langs" :key="l.code" class="lang-btn"
                :class="{active:lang===l.code}" :title="l.label"
                :aria-label="l.label" @click="setLang(l.code)">{{l.flag}} {{l.code.toUpperCase()}}</button>
      </div>
    </div>
  </header>
  <nav class="app-nav" aria-label="Navigation principale"><div id="main-nav">
    <a v-for="p in navItems" :key="p.id" :href="p.file"
       class="nav-link" :class="{active:p.active}" :aria-current="p.active?'page':null">
      <span class="nav-icon" aria-hidden="true">{{p.icon}}</span>
      <span class="nav-label">{{p.label}}</span>
    </a>
  </div></nav>
  <main id="pibird-main" class="app-main" role="main">
    <slot></slot>
  </main>
</div>`
  };

  // Enregistre les composants globaux sur une instance d'app Vue
  function registerComponents(app) {
    app.component('pibird-shell', PibirdShell);
    return app;
  }

  // ── Export global ─────────────────────────────────────────────────────────
  window.PIBIRD = {
    // Composables Vue
    useI18n, useTheme, useNav, useChart, useAudio,
    // Composants
    PibirdShell, registerComponents,
    // Utilitaires purs
    birdQuery, escHtml,
    fmtDate, fmtTime, fmtConf,
    localDateStr, daysAgo, freshnessLabel,
    buildAudioUrl, buildSpeciesLinks, fetchSpeciesImage, fetchCachedPhoto,
    getUrlParam, navigateTo,
    chartDefaults,
    // Accès direct aux traductions (pour les pages qui en auraient besoin)
    TRANSLATIONS: _TRANSLATIONS,
  };

})(Vue, BIRD_CONFIG);
