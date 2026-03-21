/**
 * bird-vue-core.js — Vue 3 composables & components for BIRDASH
 *
 * Depends on: Vue 3 (CDN global), bird-config.js, bird-shared.js (BIRDASH_UTILS)
 *
 * Pure utility functions have been extracted to bird-shared.js.
 * This file contains only Vue-specific code: composables, components,
 * inline translations, and Service Worker registration.
 *
 * Expose via window.BIRDASH :
 *   useI18n(), useTheme(), useNav(), useChart(), useAudio(), useSpeciesNames()
 *   PibirdShell, BirdImg, registerComponents()
 *   + re-exports of BIRDASH_UTILS for backward compatibility
 */

;(function (Vue, BIRD_CONFIG, U) {
  'use strict';

  // ── Service Worker ────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const { ref, computed, watch, onUnmounted } = Vue;

  // ── Traductions inline ────────────────────────────────────────────────────
  // Même contenu que bird-i18n.js — pas de fetch, disponible immédiatement.
  //
  // ═══ AJOUTER UNE NOUVELLE LANGUE ════════════════════════════════════════
  // 1. Copier un bloc existant (ex: 'en') et le renommer (ex: 'es')
  // 2. Remplir _meta: { lang:'es', label:'Español', flag:'🇪🇸' }
  // 3. Traduire toutes les clés (164 clés)
  // 4. La langue apparaîtra automatiquement dans le sélecteur
  // ═══════════════════════════════════════════════════════════════════════
  const _TRANSLATIONS = {
    fr: {
      _meta: { lang:'fr', label:'Français', flag:'🇫🇷' },
      nav_overview:'Vue d\'ensemble', nav_today:'Aujourd\'hui', nav_recent:'Récent',
      nav_detections:'Détections', nav_species:'Espèces',
      nav_biodiversity:'Biodiversité', nav_rarities:'Rarités', nav_stats:'Statistiques',
      nav_system:'Système', nav_analyses:'Analyses', nav_spectrogram:'Spectrogramme', nav_recordings:'Enregistrements', nav_settings:'Réglages',
      // Settings page
      set_location:'Localisation', set_site_name:'Nom du site', set_latitude:'Latitude', set_longitude:'Longitude',
      set_model:'Modèle de détection', set_model_choice:'Modèle IA', set_species_freq_thresh:'Seuil fréquence espèces',
      set_analysis:'Analyse', set_confidence:'Confiance', set_sensitivity:'Sensibilité',
      set_language:'Langue des espèces', set_notifications:'Notifications',
      set_notify_each:'Notifier chaque détection', set_notify_new_species:'Notifier nouvelle espèce (jamais vue)',
      set_notify_new_daily:'Notifier première espèce du jour', set_weekly_report:'Rapport hebdomadaire',
      set_save:'Enregistrer', set_saved:'Configuration enregistrée avec succès', set_reload:'Recharger',
      set_recording:'Enregistrement audio', set_overlap:'Chevauchement (s)', set_rec_length:'Durée enregistrement (s)',
      set_extraction_length:'Durée extraction (s)', set_channels:'Canaux micro', set_audio_format:'Format audio',
      set_disk_mgmt:'Gestion du disque', set_full_disk:'Disque plein', set_purge_threshold:'Seuil de purge (%)',
      set_max_files:'Max fichiers/espèce (0=illimité)', set_privacy:'Confidentialité', set_privacy_threshold:'Filtre voix humaine',
      set_services:'Services BirdNET', set_restart:'Redémarrer', set_service_active:'Actif', set_service_inactive:'Inactif',
      set_species_lists:'Listes d\'espèces', set_include_list:'Liste d\'inclusion', set_exclude_list:'Liste d\'exclusion',
      set_whitelist:'Passe-droit (bypass seuil)', set_birdweather:'BirdWeather', set_image_provider:'Source des images',
      set_rtsp:'Flux RTSP', set_rtsp_stream:'URL du flux RTSP',
      set_model_desc_birdnet:'BirdNET V2.4 — 6500 espèces, optimisé Pi (recommandé)',
      set_model_desc_mdata:'BirdNET V2.4 + filtre géographique — filtre les espèces par localisation et semaine',
      set_model_desc_mdata_v2:'BirdNET V2.4 + filtre géo V2 — filtre amélioré par localisation et semaine',
      set_model_desc_v1:'BirdNET V1 — ancien modèle, moins précis (legacy)',
      set_model_desc_perch:'Perch v2 (Google) — 15000 espèces, oiseaux + amphibiens + mammifères, plus précis',
      set_model_desc_go:'BirdNET-Go — variante expérimentale',
      set_restart_confirm:'Redémarrer les services pour appliquer ?', set_save_restart:'Enregistrer et redémarrer',
      today:'Aujourd\'hui', this_week:'Cette semaine', this_month:'Ce mois', all_time:'Total',
      detections:'Détections', species:'Espèces', avg_confidence:'Confiance moy.',
      last_detection:'Dernière détection', top_species:'Top espèces',
      activity_7d:'Activité 7 jours', activity_today:'Activité aujourd\'hui',
      last_hour:'Dernière heure', rare_today:'Espèces rares aujourd\'hui',
      recent_detections:'Détections récentes',
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
      resolution:'Résolution',
      analyses_date_range:'Plage de dates',
      analyses_pct_of_day:'de la journée',
      analyses_quarter_distrib:'Distribution par quart d\'heure',
      analyses_best_dets:'Meilleures détections',
      analyses_no_det:'Aucune détection',
      analyses_select_prompt:'Sélectionnez une ou plusieurs espèces pour explorer leurs données.',
      analyses_last_60d:'Affichage des 60 derniers jours ({total} jours au total)',
      analyses_peak_hour:'Heure de pointe',
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
      // Filtres communs
      period:'Période', conf_min:'Confiance min.', sort_by:'Trier par',
      quick_1d:'1j', quick_7d:'7j', quick_30d:'30j', quick_90d:'90j', quick_1y:'1an', quick_all:'Tout',
      // Stats
      per_day_avg:'/ jour (moy.)', trend:'Tendance',
      // Recordings
      best_recordings:'Meilleurs enregistrements', sort_conf_desc:'Confiance ↓', sort_date_desc:'Date ↓',
      sort_species_az:'Espèce A→Z', filter_species_ph:'Filtrer espèces…', clear_all:'Tout effacer',
      select_all:'Tout sélect.', no_recordings:'Aucun enregistrement trouvé.', load_more:'Charger plus',
      remaining:'{n} restants', clean_audio:'Nettoyer le son', cleaned:'Nettoyé', cleaning:'Nettoyage…',
      force:'Force', spectral_sub:'filtre passe-haut + soustraction spectrale',
      af_gain:'Gain (dB)', af_highpass:'Passe-haut (Hz)', af_lowpass:'Passe-bas (Hz)', af_off:'Off',
      af_file_info:'Infos fichier', af_duration:'Durée', af_type:'Type', af_size:'Taille',
      af_sample_rate:'Fréq. échantillonnage', af_channels:'Canaux', af_file_path:'Chemin',
      af_mono:'Mono', af_stereo:'Stéréo', af_filters:'Filtres audio',
      // Species detail
      avg_conf_short:'Confiance moy.', days_detected:'Jours détectés',
      activity_30d:'Activité — 30 jours', conf_distribution:'Distribution de confiance',
      activity_by_weekday:'Activité par jour de la semaine', description:'Description',
      // Detections
      date_range:'Plage de dates', mode:'Mode', unique_mode:'Unique',
      unique_desc:'Regroupe les séquences consécutives', all_species_placeholder:'— Toutes espèces —',
      // Biodiversity
      // Recent
      today_label:'Aujourd\'hui', yesterday:'Hier', hourly_distrib:'Distribution horaire',
      // Rarities
      click_to_edit:'Cliquer pour saisir', never_seen:'jamais vu',
      total_species:'Total espèces', rare_count:'Rares (≤{n})', seen_once:'Vues une fois',
      new_this_year:'Nouvelles {year}',
      // Spectrogram
      idle:'Inactif', connecting:'Connexion…', live:'En direct',
      start:'Démarrer', stop:'Arrêter', gain:'Gain', freq_max:'Fréq. max', clean:'Nettoyer',
      today_count:'aujourd\'hui',
      spectro_title:'Spectrogramme live', spectro_close:'Fermer spectrogramme', spectro_show:'Afficher spectrogramme',
      spectro_idle_msg:'Cliquez sur Démarrer pour activer le spectrogramme.',
      spectro_idle_desc:'L\'audio provient des MP3 récents de BirdNET — aucun conflit avec l\'analyse en cours.',
      spectro_idle_overlay:'Les détections apparaissent en overlay automatiquement.',
      spectro_connecting_msg:'Connexion au flux audio du Pi…',
      colorbar_max:'max', colorbar_min:'min',
      // System
      all_rarities:'Toutes les rarités', updated_at:'Mis à jour {time}',
      no_notable_obs:'Aucune observation notable ces 7 derniers jours.',
      quick_today:'Auj.',
    },

    en: {
      _meta: { lang:'en', label:'English', flag:'🇬🇧' },
      nav_overview:'Overview', nav_today:'Today', nav_recent:'Recent',
      nav_detections:'Detections', nav_species:'Species',
      nav_biodiversity:'Biodiversity', nav_rarities:'Rarities', nav_stats:'Statistics',
      nav_system:'System', nav_analyses:'Analysis', nav_spectrogram:'Spectrogram', nav_recordings:'Recordings', nav_settings:'Settings',
      set_location:'Location', set_site_name:'Site name', set_latitude:'Latitude', set_longitude:'Longitude',
      set_model:'Detection model', set_model_choice:'AI Model', set_species_freq_thresh:'Species frequency threshold',
      set_analysis:'Analysis', set_confidence:'Confidence', set_sensitivity:'Sensitivity',
      set_language:'Species language', set_notifications:'Notifications',
      set_notify_each:'Notify each detection', set_notify_new_species:'Notify new species (never seen)',
      set_notify_new_daily:'Notify first species of the day', set_weekly_report:'Weekly report',
      set_save:'Save', set_saved:'Configuration saved successfully', set_reload:'Reload',
      set_recording:'Audio recording', set_overlap:'Overlap (s)', set_rec_length:'Recording length (s)',
      set_extraction_length:'Extraction length (s)', set_channels:'Mic channels', set_audio_format:'Audio format',
      set_disk_mgmt:'Disk management', set_full_disk:'Full disk', set_purge_threshold:'Purge threshold (%)',
      set_max_files:'Max files/species (0=unlimited)', set_privacy:'Privacy', set_privacy_threshold:'Human voice filter',
      set_services:'BirdNET Services', set_restart:'Restart', set_service_active:'Active', set_service_inactive:'Inactive',
      set_species_lists:'Species lists', set_include_list:'Include list', set_exclude_list:'Exclude list',
      set_whitelist:'Whitelist (bypass threshold)', set_birdweather:'BirdWeather', set_image_provider:'Image source',
      set_rtsp:'RTSP Stream', set_rtsp_stream:'RTSP stream URL',
      set_model_desc_birdnet:'BirdNET V2.4 — 6,500 species, Pi-optimized (recommended)',
      set_model_desc_mdata:'BirdNET V2.4 + geographic filter — filters species by location and week',
      set_model_desc_mdata_v2:'BirdNET V2.4 + geo filter V2 — improved location and week filtering',
      set_model_desc_v1:'BirdNET V1 — older model, less accurate (legacy)',
      set_model_desc_perch:'Perch v2 (Google) — 15,000 species, birds + amphibians + mammals, more accurate',
      set_model_desc_go:'BirdNET-Go — experimental variant',
      set_restart_confirm:'Restart services to apply?', set_save_restart:'Save & restart',
      today:'Today', this_week:'This week', this_month:'This month', all_time:'All time',
      detections:'Detections', species:'Species', avg_confidence:'Avg confidence',
      last_detection:'Last detection', top_species:'Top species',
      activity_7d:'7-day activity', activity_today:'Today\'s activity',
      last_hour:'Last hour', rare_today:'Rare species today',
      recent_detections:'Recent detections',
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
      resolution:'Resolution',
      analyses_date_range:'Date range',
      analyses_pct_of_day:'of the day',
      analyses_quarter_distrib:'Quarter-hour distribution',
      analyses_best_dets:'Best detections',
      analyses_no_det:'No detections',
      analyses_select_prompt:'Select one or more species to explore their data.',
      analyses_last_60d:'Showing last 60 days ({total} days total)',
      analyses_peak_hour:'Peak hour',
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
      period:'Period', conf_min:'Min. confidence', sort_by:'Sort by',
      quick_1d:'1d', quick_7d:'7d', quick_30d:'30d', quick_90d:'90d', quick_1y:'1yr', quick_all:'All',
      per_day_avg:'/ day (avg)', trend:'Trend',
      best_recordings:'Best recordings', sort_conf_desc:'Confidence ↓', sort_date_desc:'Date ↓',
      sort_species_az:'Species A→Z', filter_species_ph:'Filter species…', clear_all:'Clear all',
      select_all:'Select all', no_recordings:'No recordings found.', load_more:'Load more',
      remaining:'{n} remaining', clean_audio:'Clean audio', cleaned:'Cleaned', cleaning:'Cleaning…',
      force:'Strength', spectral_sub:'high-pass filter + spectral subtraction',
      af_gain:'Gain (dB)', af_highpass:'HighPass (Hz)', af_lowpass:'LowPass (Hz)', af_off:'Off',
      af_file_info:'File info', af_duration:'Duration', af_type:'Type', af_size:'Size',
      af_sample_rate:'Sample rate', af_channels:'Channels', af_file_path:'Path',
      af_mono:'Mono', af_stereo:'Stereo', af_filters:'Audio filters',
      avg_conf_short:'Avg confidence', days_detected:'Days detected',
      activity_30d:'Activity — 30 days', conf_distribution:'Confidence distribution',
      activity_by_weekday:'Activity by day of week', description:'Description',
      date_range:'Date range', mode:'Mode', unique_mode:'Unique',
      unique_desc:'Groups consecutive sequences', all_species_placeholder:'— All species —',
      today_label:'Today', yesterday:'Yesterday', hourly_distrib:'Hourly distribution',
      click_to_edit:'Click to edit', never_seen:'never seen',
      total_species:'Total species', rare_count:'Rare (≤{n})', seen_once:'Seen once',
      new_this_year:'New in {year}',
      idle:'Idle', connecting:'Connecting…', live:'Live',
      start:'Start', stop:'Stop', gain:'Gain', freq_max:'Max freq.', clean:'Clean',
      today_count:'today',
      spectro_title:'Live spectrogram', spectro_close:'Close spectrogram', spectro_show:'Show spectrogram',
      spectro_idle_msg:'Click Start to activate the spectrogram.',
      spectro_idle_desc:'Audio comes from recent BirdNET MP3s — no conflict with ongoing analysis.',
      spectro_idle_overlay:'Detections appear as overlays automatically.',
      spectro_connecting_msg:'Connecting to the Pi audio stream…',
      colorbar_max:'max', colorbar_min:'min',
      all_rarities:'All rarities', updated_at:'Updated {time}',
      no_notable_obs:'No notable observations in the last 7 days.',
      quick_today:'Today',
    },

    de: {
      _meta: { lang:'de', label:'Deutsch', flag:'🇩🇪' },
      nav_overview:'Übersicht', nav_today:'Heute', nav_recent:'Aktuell',
      nav_detections:'Erkennungen', nav_species:'Arten',
      nav_biodiversity:'Biodiversität', nav_rarities:'Seltenheiten',
      nav_stats:'Statistiken', nav_system:'System', nav_analyses:'Analysen', nav_spectrogram:'Spektrogramm', nav_recordings:'Aufnahmen', nav_settings:'Einstellungen',
      set_location:'Standort', set_site_name:'Standortname', set_latitude:'Breitengrad', set_longitude:'Längengrad',
      set_model:'Erkennungsmodell', set_model_choice:'KI-Modell', set_species_freq_thresh:'Artenhäufigkeitsschwelle',
      set_analysis:'Analyse', set_confidence:'Konfidenz', set_sensitivity:'Empfindlichkeit',
      set_language:'Artensprache', set_notifications:'Benachrichtigungen',
      set_notify_each:'Bei jeder Erkennung benachrichtigen', set_notify_new_species:'Neue Art benachrichtigen',
      set_notify_new_daily:'Erste Art des Tages benachrichtigen', set_weekly_report:'Wochenbericht',
      set_save:'Speichern', set_saved:'Konfiguration erfolgreich gespeichert', set_reload:'Neu laden',
      set_recording:'Audioaufnahme', set_overlap:'Überlappung (s)', set_rec_length:'Aufnahmedauer (s)',
      set_extraction_length:'Extraktionsdauer (s)', set_channels:'Mikrofonkanäle', set_audio_format:'Audioformat',
      set_disk_mgmt:'Datenträgerverwaltung', set_full_disk:'Datenträger voll', set_purge_threshold:'Bereinigungsschwelle (%)',
      set_max_files:'Max Dateien/Art (0=unbegrenzt)', set_privacy:'Datenschutz', set_privacy_threshold:'Menschenstimmenfilter',
      set_services:'BirdNET-Dienste', set_restart:'Neustart', set_service_active:'Aktiv', set_service_inactive:'Inaktiv',
      set_species_lists:'Artenlisten', set_include_list:'Einschlussliste', set_exclude_list:'Ausschlussliste',
      set_whitelist:'Whitelist (Schwelle umgehen)', set_birdweather:'BirdWeather', set_image_provider:'Bildquelle',
      set_rtsp:'RTSP-Stream', set_rtsp_stream:'RTSP-Stream-URL',
      set_model_desc_birdnet:'BirdNET V2.4 — 6.500 Arten, Pi-optimiert (empfohlen)',
      set_model_desc_mdata:'BirdNET V2.4 + Geofilter — filtert Arten nach Standort und Woche',
      set_model_desc_mdata_v2:'BirdNET V2.4 + Geofilter V2 — verbesserter Standort- und Wochenfilter',
      set_model_desc_v1:'BirdNET V1 — alteres Modell, weniger genau (legacy)',
      set_model_desc_perch:'Perch v2 (Google) — 15.000 Arten, Vogel + Amphibien + Saugetiere, genauer',
      set_model_desc_go:'BirdNET-Go — experimentelle Variante',
      set_restart_confirm:'Dienste neu starten um anzuwenden?', set_save_restart:'Speichern & Neustart',
      today:'Heute', this_week:'Diese Woche', this_month:'Diesen Monat', all_time:'Gesamt',
      detections:'Erkennungen', species:'Arten', avg_confidence:'Ø Konfidenz',
      last_detection:'Letzte Erkennung', top_species:'Top-Arten',
      activity_7d:'7-Tage-Aktivität', activity_today:'Aktivität heute',
      last_hour:'Letzte Stunde', rare_today:'Seltene Arten heute',
      recent_detections:'Letzte Erkennungen',
      no_data:'Keine Daten', loading:'Laden…', error:'Fehler',
      date:'Datum', time:'Uhrzeit', species_name:'Art', scientific_name:'Wissenschaftlicher Name',
      confidence:'Konfidenz', audio:'Audio', play:'Abspielen',
      filter_species:'Nach Art filtern', filter_date_from:'Von', filter_date_to:'Bis',
      filter_confidence:'Min. Konfidenz', all_species:'Alle Arten',
      apply_filter:'Anwenden', reset_filter:'Zurücksetzen',
      prev_page:'← Zurück', next_page:'Weiter →', page:'Seite', of:'von', results:'Ergebnisse',
      species_detail:'Artensteckbrief', first_detection:'Erste Erkennung', last_seen:'Zuletzt gesehen',
      total_detections:'Erkennungen gesamt', max_confidence:'Max. Konfidenz',
      activity_by_hour:'Aktivität pro Stunde', monthly_presence:'Monatliche Präsenz',
      external_links:'Externe Links', listen_on:'Anhören auf', observe_on:'Beobachten auf',
      species_x_month:'Arten pro Monat', richness_per_day:'Tagesvielfalt',
      heatmap_hour_day:'Aktivität Stunde × Tag',
      rare_species:'Seltene Arten', rare_desc:'Arten mit weniger als {n} Erkennungen',
      first_seen:'Erstmals gesehen', detections_count:'Erkennungen',
      top_by_count:'Rangliste nach Erkennungen', top_by_confidence:'Rangliste nach Konfidenz',
      confidence_distrib:'Konfidenzverteilung', activity_calendar:'Aktivitätskalender',
      monthly_totals:'Monatssummen',
      db_status:'Datenbankstatus', db_size:'DB-Größe', db_total:'Einträge gesamt',
      db_first:'Erste Erkennung', db_last:'Letzte Erkennung',
      service_status:'Dienststatus', api_ok:'API aktiv', api_error:'API offline',
      data_freshness:'Datenaktualität',
      minutes_ago:'vor {n} Min.', hours_ago:'vor {n} Std.', days_ago:'vor {n} Tagen',
      months_short:['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],
      months_long:['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
      days_short:['Mo','Di','Mi','Do','Fr','Sa','So'],
      analyses_period:'Untersuchungszeitraum {from} → {to}',
      analyses_what_species:'Welche Art untersuchen?',
      analyses_loading_ph:'— laden… —', analyses_no_species:'— keine Art —',
      analyses_topn_label:'Top', analyses_topn_unit:'Arten',
      analyses_topn_btn:'Auswählen', analyses_clear_btn:'✕ Alles abwählen',
      analyses_search_ph:'🔍  Arten filtern…',
      analyses_n_selected:'{n} Art(en) ausgewählt', analyses_n_total:'{n} Arten insgesamt',
      analyses_kpi_raw:'Rohe Erkennungen', analyses_kpi_resampled:'Nach Resampling',
      analyses_kpi_conf:'Ø Konfidenz', analyses_kpi_days:'Erkennungstage',
      analyses_polar_title:'Stundenaktivität · {species}',
      analyses_series_title:'Erkennungen im Zeitverlauf · {species}',
      analyses_heatmap_title:'Tages-Heatmap · {species}',
      analyses_multi_polar:'Stundenaktivität · {species} (Hauptart)',
      analyses_multi_series:'{n} Arten vergleichen',
      analyses_no_data_period:'Keine Daten für diesen Zeitraum.',
      analyses_tooltip_det:'{n} Erkennungen · {pct}% des Tages',
      analyses_resample_raw:'Roh', analyses_resample_15:'15 Min.',
      analyses_resample_1h:'Stündlich', analyses_resample_1d:'Täglich',
      analyses_conf_label:'Min. Konfidenz', analyses_date_from:'Von', analyses_date_to:'Bis',
      analyses_quick_7d:'7T', analyses_quick_30d:'30T', analyses_quick_90d:'90T',
      analyses_quick_1y:'1J', analyses_quick_all:'Alle',
      resolution:'Auflösung',
      analyses_date_range:'Zeitraum',
      analyses_pct_of_day:'des Tages',
      analyses_quarter_distrib:'Viertelstunden-Verteilung',
      analyses_best_dets:'Beste Erkennungen',
      analyses_no_det:'Keine Erkennungen',
      analyses_select_prompt:'Wählen Sie eine oder mehrere Arten aus, um deren Daten zu erkunden.',
      analyses_last_60d:'Anzeige der letzten 60 Tage ({total} Tage insgesamt)',
      analyses_peak_hour:'Spitzenstunde',
      narr_no_data:'Keine Daten für diesen Zeitraum.',
      narr_period:'Im Zeitraum {from} → {to},',
      narr_habit_morning:'ein Morgenvogel', narr_habit_midday:'am aktivsten um die Mittagszeit',
      narr_habit_afternoon:'am aktivsten am Nachmittag',
      narr_habit_night:'nacht- oder dämmerungsaktiv', narr_habit_day:'tagaktiv',
      narr_is:'ist', narr_peak_at:'Aktivitätshöhepunkt um {time}, {pct}% der Tageserkennungen.',
      narr_activity_range:'Aktivität beginnt gegen {start} und endet gegen {end}, Dauer: {duration}.',
      narr_duration:'{n} Std. Aktivität', narr_duration_short:'konzentrierte Aktivität',
      narr_second_peak:'Ein zweiter Höhepunkt zeigt sich gegen {time}.',
      narr_night_pct:'{pct}% der Erkennungen erfolgen zwischen 21 und 5 Uhr.',
      narr_total:'Gesamt: {n} Erkennungen über {h} aktive Stunden.',
      narr_multi_intro:'{n} Arten ausgewählt. Hauptart: {species}.',
      narr_multi_hint:'Das Rosendiagramm und die Heatmap zeigen Daten von {species}. Die Zeitreihe vergleicht alle Arten.',
      sys_api_label:'API bird-server', sys_latency:'Latenz', sys_port:'Port',
      sys_species_distinct:'Verschiedene Arten', sys_days_recorded:'Aufnahmetage',
      sys_conf_range:'Konfidenz Ø / Min. / Max.', sys_last_det:'Letzte Erkennung',
      sys_date_time:'Datum / Uhrzeit', sys_det_today:'Erkennungen heute',
      sys_det_yesterday:'Erkennungen gestern', sys_no_gap:'✓ Keine Lücken erkannt',
      sys_no_gap_full:'✓ Keine Lücken — durchgehende Daten',
      sys_gaps_found:'{n} Lücke(n) insgesamt erkannt', sys_gap_missing:'{n} fehlende(r) Tag(e)',
      sys_gaps_title:'⚠️ Tage ohne Daten (> {n} Tag Lücke)',
      sys_activity_30d:'📈 Tagesaktivität — letzte 30 Tage',
      sys_hourly_distrib:'🕐 Globale Stundenverteilung',
      rarity_threshold_label:'Seltenheitsschwelle (max. Erkennungen)',
      rarity_seen_once:'💎 Nur einmal gesehen', rarity_last_rare:'🕐 Letzte seltene Erkennungen',
      latin_name:'Lateinischer Name', bio_total:'Gesamt', kpi_days_detected:'Erkennungstage',
      stats_daily_records:'🏆 Tagesrekorde', stats_annual_evolution:'📅 Jahresentwicklung',
      stats_record_most_det:'Tag mit meisten Erkennungen',
      stats_record_most_sp:'Tag mit meisten Arten', stats_record_max_conf:'Maximale Konfidenz',
      period:'Zeitraum', conf_min:'Min. Konfidenz', sort_by:'Sortieren',
      quick_1d:'1T', quick_7d:'7T', quick_30d:'30T', quick_90d:'90T', quick_1y:'1J', quick_all:'Alle',
      per_day_avg:'/ Tag (Ø)', trend:'Trend',
      best_recordings:'Beste Aufnahmen', sort_conf_desc:'Konfidenz ↓', sort_date_desc:'Datum ↓',
      sort_species_az:'Art A→Z', filter_species_ph:'Arten filtern…', clear_all:'Alles löschen',
      select_all:'Alle auswählen', no_recordings:'Keine Aufnahmen gefunden.', load_more:'Mehr laden',
      remaining:'{n} übrig', clean_audio:'Audio bereinigen', cleaned:'Bereinigt', cleaning:'Bereinigung…',
      force:'Stärke', spectral_sub:'Hochpassfilter + Spektralsubtraktion',
      af_gain:'Gain (dB)', af_highpass:'Hochpass (Hz)', af_lowpass:'Tiefpass (Hz)', af_off:'Aus',
      af_file_info:'Dateiinfo', af_duration:'Dauer', af_type:'Typ', af_size:'Größe',
      af_sample_rate:'Abtastrate', af_channels:'Kanäle', af_file_path:'Pfad',
      af_mono:'Mono', af_stereo:'Stereo', af_filters:'Audiofilter',
      avg_conf_short:'Ø Konfidenz', days_detected:'Erkennungstage',
      activity_30d:'Aktivität — 30 Tage', conf_distribution:'Konfidenzverteilung',
      activity_by_weekday:'Aktivität nach Wochentag', description:'Beschreibung',
      date_range:'Zeitraum', mode:'Modus', unique_mode:'Einzigartig',
      unique_desc:'Gruppiert aufeinanderfolgende Sequenzen', all_species_placeholder:'— Alle Arten —',
      today_label:'Heute', yesterday:'Gestern', hourly_distrib:'Stundenverteilung',
      click_to_edit:'Zum Bearbeiten klicken', never_seen:'nie gesehen',
      total_species:'Arten gesamt', rare_count:'Selten (≤{n})', seen_once:'Einmal gesehen',
      new_this_year:'Neu in {year}',
      idle:'Inaktiv', connecting:'Verbinden…', live:'Live',
      start:'Starten', stop:'Stoppen', gain:'Verstärkung', freq_max:'Max. Freq.', clean:'Bereinigen',
      today_count:'heute',
      spectro_title:'Live-Spektrogramm', spectro_close:'Spektrogramm schließen', spectro_show:'Spektrogramm anzeigen',
      spectro_idle_msg:'Klicken Sie auf Starten, um das Spektrogramm zu aktivieren.',
      spectro_idle_desc:'Audio stammt aus aktuellen BirdNET-MP3s — kein Konflikt mit der laufenden Analyse.',
      spectro_idle_overlay:'Erkennungen werden automatisch als Overlay angezeigt.',
      spectro_connecting_msg:'Verbindung zum Audio-Stream des Pi…',
      colorbar_max:'Max', colorbar_min:'Min',
      all_rarities:'Alle Seltenheiten', updated_at:'Aktualisiert {time}',
      no_notable_obs:'Keine bemerkenswerten Beobachtungen in den letzten 7 Tagen.',
      quick_today:'Heute',
    },

    nl: {
      _meta: { lang:'nl', label:'Nederlands', flag:'🇳🇱' },
      nav_overview:'Overzicht', nav_today:'Vandaag', nav_recent:'Recent',
      nav_detections:'Detecties', nav_species:'Soorten',
      nav_biodiversity:'Biodiversiteit', nav_rarities:'Zeldzaamheden',
      nav_stats:'Statistieken', nav_system:'Systeem', nav_analyses:'Analyse', nav_spectrogram:'Spectrogram', nav_recordings:'Opnames', nav_settings:'Instellingen',
      set_location:'Locatie', set_site_name:'Sitenaam', set_latitude:'Breedtegraad', set_longitude:'Lengtegraad',
      set_model:'Detectiemodel', set_model_choice:'AI-model', set_species_freq_thresh:'Soortfrequentiedrempel',
      set_analysis:'Analyse', set_confidence:'Betrouwbaarheid', set_sensitivity:'Gevoeligheid',
      set_language:'Soorttaal', set_notifications:'Meldingen',
      set_notify_each:'Elke detectie melden', set_notify_new_species:'Nieuwe soort melden',
      set_notify_new_daily:'Eerste soort van de dag melden', set_weekly_report:'Weekrapport',
      set_save:'Opslaan', set_saved:'Configuratie succesvol opgeslagen', set_reload:'Herladen',
      set_recording:'Audio-opname', set_overlap:'Overlap (s)', set_rec_length:'Opnameduur (s)',
      set_extraction_length:'Extractieduur (s)', set_channels:'Microfoonkanalen', set_audio_format:'Audioformaat',
      set_disk_mgmt:'Schijfbeheer', set_full_disk:'Schijf vol', set_purge_threshold:'Opschoondrempel (%)',
      set_max_files:'Max bestanden/soort (0=onbeperkt)', set_privacy:'Privacy', set_privacy_threshold:'Menselijke stemfilter',
      set_services:'BirdNET-services', set_restart:'Herstarten', set_service_active:'Actief', set_service_inactive:'Inactief',
      set_species_lists:'Soortenlijsten', set_include_list:'Inclusielijst', set_exclude_list:'Exclusielijst',
      set_whitelist:'Whitelist (drempel omzeilen)', set_birdweather:'BirdWeather', set_image_provider:'Afbeeldingsbron',
      set_rtsp:'RTSP-stream', set_rtsp_stream:'RTSP-stream-URL',
      set_model_desc_birdnet:'BirdNET V2.4 — 6.500 soorten, Pi-geoptimaliseerd (aanbevolen)',
      set_model_desc_mdata:'BirdNET V2.4 + geofilter — filtert soorten op locatie en week',
      set_model_desc_mdata_v2:'BirdNET V2.4 + geofilter V2 — verbeterd locatie- en weekfilter',
      set_model_desc_v1:'BirdNET V1 — ouder model, minder nauwkeurig (legacy)',
      set_model_desc_perch:'Perch v2 (Google) — 15.000 soorten, vogels + amfibieen + zoogdieren, nauwkeuriger',
      set_model_desc_go:'BirdNET-Go — experimentele variant',
      set_restart_confirm:'Services herstarten om toe te passen?', set_save_restart:'Opslaan & herstarten',
      today:'Vandaag', this_week:'Deze week', this_month:'Deze maand', all_time:'Totaal',
      detections:'Detecties', species:'Soorten', avg_confidence:'Gem. betrouwbaarheid',
      last_detection:'Laatste detectie', top_species:'Top soorten',
      activity_7d:'7-daagse activiteit', activity_today:'Activiteit vandaag',
      last_hour:'Laatste uur', rare_today:'Zeldzame soorten vandaag',
      recent_detections:'Recente detecties',
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
      resolution:'Resolutie',
      analyses_date_range:'Datumbereik',
      analyses_pct_of_day:'van de dag',
      analyses_quarter_distrib:'Kwartier-verdeling',
      analyses_best_dets:'Beste detecties',
      analyses_no_det:'Geen detecties',
      analyses_select_prompt:'Selecteer een of meer soorten om hun gegevens te verkennen.',
      analyses_last_60d:'Weergave van de laatste 60 dagen ({total} dagen totaal)',
      analyses_peak_hour:'Piekuur',
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
      period:'Periode', conf_min:'Min. betrouwbaarheid', sort_by:'Sorteren',
      quick_1d:'1d', quick_7d:'7d', quick_30d:'30d', quick_90d:'90d', quick_1y:'1jr', quick_all:'Alles',
      per_day_avg:'/ dag (gem.)', trend:'Trend',
      best_recordings:'Beste opnames', sort_conf_desc:'Betrouwbaarheid ↓', sort_date_desc:'Datum ↓',
      sort_species_az:'Soort A→Z', filter_species_ph:'Soorten filteren…', clear_all:'Alles wissen',
      select_all:'Alles selecteren', no_recordings:'Geen opnames gevonden.', load_more:'Meer laden',
      remaining:'{n} resterend', clean_audio:'Audio opschonen', cleaned:'Opgeschoond', cleaning:'Opschonen…',
      force:'Sterkte', spectral_sub:'hoogdoorlaatfilter + spectrale subtractie',
      af_gain:'Gain (dB)', af_highpass:'Hoogdoorlaat (Hz)', af_lowpass:'Laagdoorlaat (Hz)', af_off:'Uit',
      af_file_info:'Bestandsinfo', af_duration:'Duur', af_type:'Type', af_size:'Grootte',
      af_sample_rate:'Samplefrequentie', af_channels:'Kanalen', af_file_path:'Pad',
      af_mono:'Mono', af_stereo:'Stereo', af_filters:'Audiofilters',
      avg_conf_short:'Gem. betrouwbaarheid', days_detected:'Detectiedagen',
      activity_30d:'Activiteit — 30 dagen', conf_distribution:'Betrouwbaarheidsverdeling',
      activity_by_weekday:'Activiteit per weekdag', description:'Beschrijving',
      date_range:'Datumbereik', mode:'Modus', unique_mode:'Uniek',
      unique_desc:'Groepeert opeenvolgende sequenties', all_species_placeholder:'— Alle soorten —',
      today_label:'Vandaag', yesterday:'Gisteren', hourly_distrib:'Uurverdeling',
      click_to_edit:'Klik om te bewerken', never_seen:'nooit gezien',
      total_species:'Totaal soorten', rare_count:'Zeldzaam (≤{n})', seen_once:'Eenmaal gezien',
      new_this_year:'Nieuw in {year}',
      idle:'Inactief', connecting:'Verbinden…', live:'Live',
      start:'Starten', stop:'Stoppen', gain:'Versterking', freq_max:'Max. freq.', clean:'Opschonen',
      today_count:'vandaag',
      spectro_title:'Live spectrogram', spectro_close:'Spectrogram sluiten', spectro_show:'Spectrogram tonen',
      spectro_idle_msg:'Klik op Starten om het spectrogram te activeren.',
      spectro_idle_desc:'Audio komt van recente BirdNET MP3\'s — geen conflict met lopende analyse.',
      spectro_idle_overlay:'Detecties verschijnen automatisch als overlay.',
      spectro_connecting_msg:'Verbinden met de audiostream van de Pi…',
      colorbar_max:'max', colorbar_min:'min',
      all_rarities:'Alle zeldzaamheden', updated_at:'Bijgewerkt {time}',
      no_notable_obs:'Geen opmerkelijke waarnemingen in de afgelopen 7 dagen.',
      quick_today:'Vandaag',
    },
  };

  // ── Singletons réactifs (partagés dans toute l'app) ───────────────────────
  // Un seul ref par page — Vue garantit que tous les composables qui y accèdent
  // voient le même changement et réagissent de façon coordonnée.
  const _lang  = ref(localStorage.getItem('birdash_lang')  || 'fr');
  const _theme = ref(localStorage.getItem('birdash-theme') || 'forest');

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
      localStorage.setItem('birdash_lang', code);
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
      localStorage.setItem('birdash-theme', id);
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
    settings:     'nav_settings',
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

  // ── Utility references from bird-shared.js (BIRDASH_UTILS) ──────────────
  // Pure utility functions are defined in bird-shared.js and accessed via U.
  // Wrappers below provide backward compatibility and inject reactive state
  // (e.g. current language) where needed.

  // buildSpeciesLinks wrapper: auto-injects current reactive language
  function buildSpeciesLinks(comName, sciName) {
    return U.buildSpeciesLinks(comName, sciName, _lang.value);
  }

  // ── useAudio ──────────────────────────────────────────────────────────────
  function useAudio() {
    let _current = null;
    const playingFile = ref(null);

    function toggleAudio(fileName) {
      const url = U.buildAudioUrl(fileName);
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

  // ── Species name translation (BirdNET labels) ───────────────────────────
  // Shared cache: { 'fr': { 'Pica pica': 'Pie bavarde' }, 'en': { ... } }
  const _spNamesCache = {};   // lang → { sci → comName }
  const _spNamesLoading = {}; // lang → Promise

  /**
   * Load species name mapping for a given language.
   * Uses BirdNET l18n label files served via /api/species-names?lang=xx
   * Returns the mapping object { sciName: translatedComName }
   */
  async function _loadSpNames(lang) {
    if (_spNamesCache[lang]) return _spNamesCache[lang];
    if (_spNamesLoading[lang]) return _spNamesLoading[lang];

    _spNamesLoading[lang] = (async () => {
      try {
        const res = await fetch(`${BIRD_CONFIG.apiUrl}/species-names?lang=${lang}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _spNamesCache[lang] = await res.json();
      } catch(e) {
        console.warn(`[spNames] Failed to load ${lang}:`, e.message);
        _spNamesCache[lang] = {};
      }
      delete _spNamesLoading[lang];
      return _spNamesCache[lang];
    })();

    return _spNamesLoading[lang];
  }

  /**
   * useSpeciesNames() — composable for translated species names.
   *
   * Returns:
   *   spName(comName, sciName) — returns the translated common name
   *   spNamesReady            — ref(bool) true when names are loaded
   *
   * Auto-reloads when the language changes.
   */
  function useSpeciesNames() {
    const spNamesReady = ref(false);
    const _names = ref({});

    async function reload(lang) {
      spNamesReady.value = false;
      _names.value = await _loadSpNames(lang);
      spNamesReady.value = true;
    }

    // Load immediately + watch lang changes
    reload(_lang.value);
    watch(_lang, (newLang) => reload(newLang));

    /**
     * Translate a species name.
     * @param {string} comName - Original Com_Name from the database
     * @param {string} sciName - Sci_Name (used as lookup key)
     * @returns {string} Translated name, or original comName as fallback
     */
    function spName(comName, sciName) {
      if (!sciName || !_names.value) return comName || '';
      return _names.value[sciName] || comName || sciName;
    }

    return { spName, spNamesReady };
  }

  // ── Composant PibirdShell ─────────────────────────────────────────────────
  // Encapsule le header, la navigation, les switchers thème/langue et le <main>.
  // Usage : <birdash-shell page="species"> … contenu … </birdash-shell>
  const PibirdShell = {
    props: { page: { type: String, default: '' } },
    setup(props) {
      const { lang, t, setLang, langs } = useI18n();
      const { theme, themes, setTheme } = useTheme();
      const { navItems, siteName }      = useNav(props.page);
      const langOpen = ref(false);
      const currentLang = computed(() => langs.find(l => l.code === lang.value) || langs[0]);
      return { lang, t, setLang, langs, theme, themes, setTheme, navItems, siteName, langOpen, currentLang };
    },
    directives: {
      'click-outside': {
        mounted(el, binding) {
          el._clickOutside = e => { if (!el.contains(e.target)) binding.value(); };
          document.addEventListener('click', el._clickOutside);
        },
        unmounted(el) { document.removeEventListener('click', el._clickOutside); }
      }
    },
    template: `
<div class="app-shell">
  <a href="#birdash-main" class="skip-link">Aller au contenu</a>
  <header class="app-header" role="banner">
    <div class="header-brand">
      <img src="robin-logo.svg" class="brand-logo" alt="BIRDASH Robin">
      <div class="brand-text">
        <span class="brand-name">BIRDASH</span>
        <span class="brand-sub">{{siteName}}</span>
      </div>
    </div>
    <div class="header-right">
      <div class="theme-switcher-wrap">
        <button v-for="th in themes" :key="th.id" class="theme-btn"
                :class="{active:theme===th.id}" :data-t="th.id" :title="th.label"
                :aria-label="th.label" @click="setTheme(th.id)"></button>
      </div>
      <div class="lang-dropdown" :class="{open:langOpen}" v-click-outside="()=>langOpen=false">
        <button class="lang-toggle" @click="langOpen=!langOpen" :aria-expanded="langOpen" aria-haspopup="listbox">
          <span class="lang-flag">{{currentLang.flag}}</span>
          <span class="lang-code">{{lang.toUpperCase()}}</span>
          <svg class="lang-chevron" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
        </button>
        <div class="lang-menu" role="listbox" v-show="langOpen">
          <button v-for="l in langs" :key="l.code" class="lang-option"
                  :class="{active:lang===l.code}" role="option"
                  :aria-selected="lang===l.code"
                  @click="setLang(l.code);langOpen=false">
            <span class="lang-flag">{{l.flag}}</span>
            <span class="lang-label">{{l.label}}</span>
            <span class="lang-check" v-if="lang===l.code">✓</span>
          </button>
        </div>
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
  <main id="birdash-main" class="app-main" role="main">
    <slot></slot>
  </main>
</div>`
  };

  // ── Composant BirdImg ────────────────────────────────────────────────────
  // Image avec animation de chargement (3 dots wave).
  // Usage : <bird-img :src="url" :alt="text" class="my-class" />
  const BirdImg = {
    props: {
      src:   { type: String, default: '' },
      alt:   { type: String, default: '' },
    },
    setup(props) {
      const loaded = ref(false);
      const errored = ref(false);
      // Reset on src change
      watch(() => props.src, () => { loaded.value = false; errored.value = false; });
      function onLoad() { loaded.value = true; }
      function onError() { loaded.value = true; errored.value = true; }
      return { loaded, errored, onLoad, onError };
    },
    template: `
      <div class="img-wrap">
        <div class="img-loader" :class="{ hidden: loaded }">
          <span></span><span></span><span></span>
        </div>
        <img v-if="src && !errored"
             :src="src" :alt="alt"
             :class="{ loaded: loaded }"
             @load="onLoad" @error="onError"
             loading="lazy">
        <div v-if="errored" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2rem;color:var(--text-faint);">🦜</div>
      </div>
    `
  };

  // Enregistre les composants globaux sur une instance d'app Vue
  function registerComponents(app) {
    app.component('birdash-shell', PibirdShell);
    app.component('bird-img', BirdImg);
    return app;
  }

  // ── Export global ─────────────────────────────────────────────────────────
  window.BIRDASH = {
    // Vue composables
    useI18n, useTheme, useNav, useChart, useAudio, useSpeciesNames,
    // Vue components
    PibirdShell, registerComponents,
    // Wrapper with reactive lang injection (calls BIRDASH_UTILS under the hood)
    buildSpeciesLinks,
    // Re-exports from BIRDASH_UTILS for backward compatibility
    // (pages destructure these from BIRDASH, so they must remain available)
    birdQuery:        U.birdQuery,
    escHtml:          U.escHtml,
    fmtDate:          U.fmtDate,
    fmtTime:          U.fmtTime,
    fmtConf:          U.fmtConf,
    localDateStr:     U.localDateStr,
    daysAgo:          U.daysAgo,
    freshnessLabel:   U.freshnessLabel,
    buildAudioUrl:    U.buildAudioUrl,
    fetchSpeciesImage:U.fetchSpeciesImage,
    fetchCachedPhoto: U.fetchCachedPhoto,
    getUrlParam:      U.getUrlParam,
    navigateTo:       U.navigateTo,
    chartDefaults:    U.chartDefaults,
    spinnerHTML:      U.spinnerHTML,
    // Direct access to translations
    TRANSLATIONS: _TRANSLATIONS,
  };

})(Vue, BIRD_CONFIG, window.BIRDASH_UTILS);
