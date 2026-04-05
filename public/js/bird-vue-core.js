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

  const { ref, computed, watch, onUnmounted, onMounted, nextTick, reactive } = Vue;

  // ── Spectrogram Modal — global reactive state ───────────────────────────
  const _spectroModal = Vue.reactive({
    open: false,
    fileName: '',
    speciesName: '',
    sciName: '',
    confidence: 0,
    date: '',
    time: ''
  });

  let _spectroFocusTrap = null;
    function openSpectroModal(opts) {
    Object.assign(_spectroModal, { open: true, ...opts });
  }
  function closeSpectroModal() {
    _spectroModal.open = false;
  }

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
      nav_sec_realtime:'En direct', nav_sec_history:'Historique', nav_sec_species:'Espèces', nav_sec_insights:'Analyses', nav_sec_system:'Station',
      nav_sec_observe:'Observer', nav_sec_explore:'Explorer',
      nav_overview:'Accueil', nav_today:'Aujourd\'hui', nav_recent:'Activité', nav_review:'À valider',
      nav_detections:'Détections', nav_species:'Espèces',
      nav_biodiversity:'Biodiversité', nav_rarities:'Rarités', nav_stats:'Statistiques',
      nav_system:'Monitoring', nav_analyses:'Analyses', nav_models:'Modèles', nav_terminal:'Terminal', nav_spectrogram:'Live', nav_recordings:'Enregistrements', nav_gallery:'Meilleures captures', nav_settings:'Configuration', nav_timeline:'Calendrier', nav_calendar:'Calendrier', nav_log:'Log live',
      log_live:'En direct', log_paused:'En pause', log_disconnected:'Déconnecté', log_pause:'Pause', log_resume:'Reprendre', log_clear:'Effacer', log_errors:'Erreurs', log_lines:'Lignes', log_all:'Tous', log_waiting:'En attente de logs...',
      gallery_title:'Meilleures captures', gallery_tab_best:'Meilleures', gallery_tab_library:'Bibliothèque audio', gallery_delete:'Supprimer', gallery_delete_confirm:'Supprimer cette détection et ses fichiers ?', top_detections_per_species:'meilleures détections',
      // Settings page
      set_location:'Localisation', set_site_name:'Nom du site', set_site_brand:'Nom principal (header)', set_latitude:'Latitude', set_longitude:'Longitude',
      set_model:'Modèle de détection', set_model_choice:'Modèle IA', set_species_freq_thresh:'Seuil fréquence espèces',
      set_analysis:'Analyse', set_params:'Paramètres', set_shared_params:'Paramètres communs', set_confidence:'Confiance', set_birdnet_conf:'Confiance BirdNET', set_perch_conf:'Confiance Perch', set_perch_margin:'Marge Perch (top1-top2)', set_sensitivity:'Sensibilité',
      set_language:'Langue des espèces', set_notifications:'Notifications',
      set_notify_each:'Notifier chaque détection', set_notify_new_species:'Notifier nouvelle espèce (jamais vue)',
      set_notify_new_daily:'Notifier première espèce du jour', set_weekly_report:'Rapport hebdomadaire',
      set_notif_urls:'URLs de notification (Apprise)', set_notif_urls_help:'Une URL par ligne. Exemples :',
      set_notif_title:'Titre de la notification', set_notif_body:'Corps du message',
      set_notif_body_help:'Variables : $comname, $sciname, $confidence, $date, $time',
      set_notif_test:'Tester', set_notif_testing:'Envoi en cours…', set_notif_test_ok:'Notification envoyée !',
      set_notif_test_fail:'Échec : {error}', set_notif_cooldown:'Délai min. entre notifications (secondes)',
      set_notif_no_urls:'Aucune URL configurée — les notifications ne seront pas envoyées.',
      set_alerts_title:'Alertes système', set_alerts_desc:'Recevez une notification quand un seuil critique est dépassé.',
      set_notif_events_title:'Événements notifiés', set_notif_events_desc:'Cochez les événements pour lesquels vous souhaitez recevoir une notification.',
      set_notif_cat_birds:'Détections d\'espèces', set_notif_cat_system:'Surveillance système',
      set_alert_temp_warn:'Température alerte', set_alert_temp_crit:'Température critique',
      set_alert_disk_warn:'Espace disque alerte', set_alert_ram_warn:'Mémoire RAM alerte',
      set_alert_backlog:'Backlog analyse', set_alert_no_det:'Silence détections',
      set_alert_svc_down:'Alerter si un service critique tombe',
      set_notif_cat_bird_smart:'Alertes oiseaux intelligentes',
      set_alert_influx:'Afflux inhabituel (>3x la moyenne)', set_alert_missing:'Espèce commune absente (après midi)', set_alert_rare_visitor:'Visiteur rare détecté',
      set_tab_detection:'Détection', set_tab_audio:'Audio', set_tab_notif:'Notifications', set_tab_station:'Station', set_tab_services:'Services', set_tab_species:'Espèces', set_tab_system:'Système', set_tab_backup:'Sauvegarde', set_tab_database:'Base de données', set_tab_terminal:'Terminal',
      bkp_init:'Initialisation', bkp_db:'Base de données', bkp_config:'Configuration', bkp_projects:'Projets', bkp_audio:'BirdSongs', bkp_upload:'Upload', bkp_mount:'Montage', bkp_done:'Terminé', bkp_stopped_by_user:'Arrêté par l\'utilisateur', bkp_starting:'Démarrage…', bkp_next_run:'Prochain', bkp_no_schedule:'Aucune planification — mode manuel', bkp_history:'Historique',
      share:'Partager', analyze_deep:'Analyse approfondie', fav_add:'Ajouter aux favoris', fav_remove:'Retirer des favoris', nav_favorites:'Favoris', fav_total:'Total favoris', fav_active_today:'Actifs aujourd\'hui', fav_total_dets:'Détections totales', fav_today_dets:'Détections du jour', fav_added:'Ajouté le', fav_last_seen:'Dernière obs.', fav_first_seen:'Première obs.', fav_avg_conf:'Confiance moy.', fav_empty:'Aucun favori — ajoutez des espèces avec ☆', fav_sort_name:'Nom', fav_sort_recent:'Récent', fav_sort_count:'Détections', photo_ban:'Bannir', photo_set_preferred:'Définir par défaut', photo_banned:'Photo bannie', photo_reset:'Réinitialiser', fav_only:'Favoris uniquement', phenology_calendar:'Calendrier phénologique', notifications:'Notifications', wn_empty:'Rien de nouveau',
      set_save:'Enregistrer', set_saved:'Configuration enregistrée avec succès', set_defaults:'Défaut', set_defaults_confirm:'Remettre tous les paramètres de détection à leurs valeurs par défaut ?', set_defaults_applied:'Valeurs par défaut appliquées — cliquez Enregistrer pour confirmer',
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
      set_model_desc_perch:'Google Perch V2 — 10 340 oiseaux parmi 15K espèces totales',
      set_model_desc_perch_fp16:'Google — 10 340 oiseaux, ~384 ms sur Pi 5. Qualité quasi parfaite vs original (top-1 100%, top-5 99%).',
      set_model_desc_perch_dynint8:'Google — 10 340 oiseaux, ~299 ms sur Pi 5, ~700 ms sur Pi 4. 4× plus léger (top-1 93%).',
      set_model_desc_perch_original:'Google — 10 340 oiseaux, référence non modifiée. Le plus précis mais le plus lourd (~435 ms sur Pi 5).',
      set_model_desc_go:'BirdNET-Go — variante expérimentale',
      set_restart_confirm:'Redémarrer les services pour appliquer ?', set_save_restart:'Enregistrer et redémarrer',
      today:'Aujourd\'hui', this_week:'Cette semaine', this_month:'Ce mois', all_time:'Total',
      detections:'Détections', species:'Espèces', avg_confidence:'Confiance moy.',
      last_detection:'Dernière détection', top_species:'Top espèces',
      activity_7d:'Activité 7 jours', activity_today:'Activité aujourd\'hui',
      last_hour:'Dernière heure', new_species:'Nouvelles espèces', rare_today:'Espèces rares aujourd\'hui',
      recent_detections:'Détections récentes', today_log:'Journal du jour',
      no_data:'Aucune donnée', loading:'Chargement…', error:'Erreur', network_error:'Erreur réseau',
      date:'Date', time:'Heure', species_name:'Espèce', scientific_name:'Nom scientifique',
      confidence:'Confiance', audio:'Audio', play:'Écouter',
      filter_species:'Filtrer par espèce', filter_order:'Ordre taxonomique', filter_family:'Famille',
      all_orders:'Tous les ordres', all_families:'Toutes les familles',
      filter_date_from:'Du', filter_date_to:'Au',
      filter_confidence:'Confiance min.', all_species:'Toutes espèces',
      apply_filter:'Appliquer', reset_filter:'Réinitialiser', default_btn:'Défaut',
      prev_page:'← Précédent', next_page:'Suivant →', page:'Page', of:'sur', results:'résultats',
      species_detail:'Fiche espèce', first_detection:'Première détection', last_seen:'Dernière fois',
      total_detections:'Total détections', max_confidence:'Confiance max.',
      activity_by_hour:'Activité par heure', monthly_presence:'Présence mensuelle',
      external_links:'Liens externes', listen_on:'Écouter sur', observe_on:'Observer sur',
      species_x_month:'Espèces par mois', richness_per_day:'Richesse journalière',
      heatmap_hour_day:'Activité heure × jour',
      kb_shortcuts_hint:'Espace = lecture, ← → = navigation',
      // New pages i18n
      db_tables:'Tables', db_refresh:'Rafraîchir', db_schema:'Schema', db_query:'Requête SQL', db_exec:'Exécuter', db_executing:'Exécution...', db_readonly:'Lecture seule — SELECT, PRAGMA, WITH uniquement', db_rows:'{n} ligne(s)', db_col:'Colonne', db_type:'Type', db_new:'Nouveau',
      dual_model:'Dual-model', dual_desc:'Analyse chaque fichier avec deux modèles en parallèle', secondary_model:'Modèle secondaire', dual_active:'{model} actif', dual_wait:'Le modèle secondaire sera chargé au prochain cycle (~5 min).', dual_status_active:'actif', dual_status_primary:'Primaire', dual_status_secondary:'Secondaire',
      audio_profile:'Profil actif', audio_strategy:'Stratégie multi-canaux', audio_strategy_2ch:'Disponible uniquement avec 2 microphones.', audio_save:'Sauvegarder', audio_refresh:'Rafraîchir', audio_no_device:'Aucun périphérique audio détecté.', audio_wiring:'Câblage microphones', audio_sr_note:'Sample rate de sortie : 32 000 Hz (imposé par Perch V2, non modifiable)',
      cal_title:'Calibration inter-canaux', cal_need_2ch:'La calibration nécessite 2 microphones.', cal_expired:'Calibration expirée (> 7 jours). Recalibration recommandée.', cal_not_done:'Les deux canaux ne sont pas calibrés.', cal_instructions:'Placez les deux microphones côte à côte (< 5 cm), même direction. La capture dure 10 secondes.', cal_start:'Démarrer la calibration', cal_capturing:'Capture en cours... (10 secondes)', cal_apply:'Appliquer et sauvegarder', cal_retry:'Recommencer',
      notif_channel:'Canal de notification', notif_on:'Notifications actives', notif_off:'Notifications désactivées', notif_save:'Sauvegarder', notif_test:'Tester', notif_rare:'Espèce rare', notif_rare_desc:'Jamais vue ou moins de N détections au total', notif_season:'Première de saison', notif_season_desc:'Pas vue depuis N jours', notif_season_days_label:'Absence depuis', notif_new:'Nouvelle espèce — Jamais détectée', notif_daily:'Première du jour', notif_daily_warn:'bruyant : ~50 notifs/jour', notif_each:'Chaque détection', notif_each_warn:'très bruyant : ~1000+ notifs/jour', notif_favorites:'Favoris', notif_favorites_desc:'Notification quand un favori est détecté (1× par jour par espèce)', notif_report:'Rapport hebdomadaire', notif_bird_alerts:'Alertes oiseaux', notif_sys_alerts:'Alertes système', unit_days:'jours', audio_overlap:'Chevauchement des fenêtres',
      review_suspects:'{n} suspectes', review_total:'total', review_selected:'{n} sélectionnées', review_select_all:'Tout sélectionner', review_deselect:'Tout désélectionner', review_confirm:'Confirmer', review_reject:'Rejeter', review_reject_rule:'Rejeter par règle', review_confirm_q:'Confirmer {n} détections ?', review_reject_q:'Rejeter {n} détections ?', review_reject_rule_q:'Rejeter {n} détections "{rule}" ?', review_none:'Aucune détection suspecte pour cette période.', review_showing:'affichées', review_show_more:'Afficher plus', review_confirmed_msg:'Confirmé', review_rejected_msg:'Rejeté', review_doubtful_msg:'Douteux', review_action_error:'Erreur de validation', review_detections:'détections',
      review_purge:'Purger les rejetées', review_purge_title:'Suppression des détections rejetées', review_purge_warning:'Les détections suivantes seront supprimées de la base de données et les fichiers audio associés seront effacés. Cette action est irréversible.', review_purge_confirm:'Supprimer définitivement', review_delete_done:'Suppression terminée',
      models_detections:'détections', models_species:'espèces', models_avg_conf:'conf. moy.', models_daily:'Détections par jour et par modèle', models_exclusive:'Espèces exclusives', models_overlap:'Espèces détectées par les deux modèles', models_ratio:'Ratio', models_none:'Aucune espèce exclusive',
      species_tab:'Inclusion / Exclusion d\'espèces', species_desc:'Contrôle quelles espèces sont détectées. Un nom scientifique par ligne.', species_include_desc:'Si remplie, seules ces espèces seront détectées.', species_exclude_desc:'Ces espèces seront ignorées.',
      fp_preview:'Prévisualiser', fp_recording:'Enregistrement (3s)...', fp_title:'Avant / Après filtres', fp_before:'Avant (signal brut)', fp_after:'Après (filtres appliqués)', fp_hint:'Spectrogramme généré à partir de 3 secondes du micro. Relancez pour actualiser.',
      audio_1ch:'1 microphone (canal 0)', audio_2ch:'2 microphones (canaux 0+1)', audio_highpass:'Filtre passe-haut', audio_lowpass:'Filtre passe-bas', audio_lp_birds:'Oiseaux', audio_lp_wide:'Large', audio_lp_full:'Complet', audio_denoise:'Réduction de bruit spectrale', audio_denoise_desc:'Atténue le bruit de fond constant (vent, trafic, insectes) par masquage spectral. Nécessite scipy + noisereduce.', audio_denoise_light:'Léger', audio_denoise_strong:'Fort', audio_denoise_warn:'Un réglage élevé peut atténuer des chants faibles.', audio_rms:'Normalisation RMS', audio_levels:'Niveaux d\'entrée en temps réel', audio_test:'Test audio (5 secondes)', audio_test_btn:'Tester l\'audio', audio_duplicate:'Dupliquer', audio_delete:'Supprimer', audio_calm:'Calme', audio_road:'Route', audio_urban:'Urbain', audio_cpu_warn:'Charge CPU élevée sur RPi5', audio_threshold:'Seuil', audio_max_det:'détections max au total', audio_target:'Cible',
      audio_enabled:'Activé', audio_start:'Démarrer', audio_stop:'Arrêter', audio_click_start:'Cliquez sur Démarrer pour afficher les niveaux audio en temps réel.', audio_detected:'Périphériques audio détectés', audio_sub_device:'Périphérique', audio_sub_profile:'Profil & Paramètres', audio_sub_cal:'Calibration', audio_sub_monitor:'Monitoring', audio_last_cal:'Dernière calibration', audio_ch0:'Canal 0 (CH0)', audio_ch1:'Canal 1 (CH1)', audio_gain_comp:'Gain compensatoire', audio_sum:'Sommation', audio_sum_desc:'Combine les deux signaux (gain SNR +3dB)', audio_max:'Maximum', audio_max_desc:'Retient le score le plus élevé (maximise le rappel)', audio_vote:'Vote', audio_vote_desc:'Exige la détection sur les deux canaux (réduit faux positifs)',
      ag_title:'Normalisation adaptative', ag_desc:'Ajuste le gain logiciel selon le bruit ambiant. Mode observateur : calcule sans appliquer.', ag_enabled:'Activer', ag_mode:'Mode', ag_conservative:'Conservateur', ag_balanced:'Équilibré', ag_night:'Nuit', ag_observer:'Observateur uniquement', ag_apply:'Appliquer le gain', ag_min:'Gain min', ag_max:'Gain max', ag_interval:'Intervalle', ag_history:'Historique', ag_target:'Plancher cible', ag_clip_guard:'Protection clipping', ag_hold:'Gel activité', ag_state:'État actuel', ag_noise_floor:'Plancher bruit', ag_activity:'Activité', ag_peak:'Crête', ag_current_gain:'Gain actuel', ag_recommended:'Gain recommandé', ag_reason:'Raison', ag_disabled:'Désactivé', ag_stable:'Stable', ag_step_up:'Montée', ag_step_down:'Descente', ag_clip:'Protection clipping', ag_activity_hold:'Gel (activité)', ag_observer_mode:'Observation', ag_init:'Initialisation', ag_not_enough:'Données insuffisantes', ag_advanced:'Paramètres avancés', ag_noise_pct:'Percentile bruit',
      retention_days:'Rétention audio (jours)', terminal_desc:'Bash — supporte Claude Code', spectro_live:'Live Micro', spectro_clips:'Clips détections',
      audio_cleaning:'Nettoyage audio…', audio_analyzing:'Analyse audio…', audio_unavailable:'Fichier audio indisponible', audio_not_found:'Fichier audio introuvable (404)', audio_decode_error:'Erreur de décodage audio', audio_no_file:'Pas de fichier audio enregistré', audio_bad_name:'Nom de fichier non reconnu', audio_clean_progress:'Nettoyage…', audio_clean_done:'Nettoyé', audio_clean_btn:'Nettoyer le son', no_data:'Aucune donnée', svc_engine:'Moteur de détection', svc_recording:'Capture audio', svc_web:'Serveur web', svc_terminal:'Terminal web', sys_tab_health:'Santé', sys_tab_model:'Modèle', sys_tab_data:'Données', sys_tab_external:'Externe',
      shannon_index:'Indice de Shannon', shannon_evenness:'Équitabilité', personal_notes:'Notes personnelles',
      bio_taxonomy_orders:'Répartition par ordre', bio_taxonomy_families:'Familles détectées',
      rare_species:'Espèces rares', rare_desc:'Espèces avec moins de {n} détections',
      first_seen:'Vue la première fois', detections_count:'Nb détections',
      top_by_count:'Classement par détections', top_by_confidence:'Classement par confiance',
      confidence_distrib:'Distribution confiance', activity_calendar:'Calendrier d\'activité',
      monthly_totals:'Totaux mensuels',
      freq_range:'Plage de fréquence',
      nav_weather:'Météo & Oiseaux', weather_activity:'Météo & Activité', weather_correlation:'Corrélation météo/activité', weather_best:'Meilleures conditions : ~{temp}°C, ~{precip}mm pluie/jour', weather_best_full:'Meilleures conditions : ~{temp}°C, ~{precip}mm pluie, vent ~{wind}km/h', weather_forecast:'Prévision demain', weather_trend:'activité prévue {pct}%', weather_top_species:'Espèces par conditions météo', temperature:'Température', precipitation:'Précipitations', wind:'Vent',
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
      analyses_kpi_conf:'Confiance moyenne', analyses_kpi_days:'Jours détectée', analyses_kpi_avg_day:'Moy. / jour',
      analyses_polar_title:'Activité horaire · {species}',
      analyses_series_title:'Détections dans le temps · {species}',
      analyses_heatmap_title:'Heatmap journalière · {species}',
      circadian_comparison:'Comparaison circadienne',
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
      // Group taxonomy analysis
      grp_mode_species:'Par espèce', grp_mode_taxo:'Par groupe taxonomique',
      grp_title_order:'Analyse de l\'ordre {name}', grp_title_family:'Analyse de la famille {name}',
      grp_kpi_species:'Espèces dans le groupe', grp_kpi_detections:'Détections totales',
      grp_kpi_conf:'Confiance moyenne', grp_kpi_days:'Jours actifs', grp_kpi_avg_day:'Moy. / jour',
      grp_polar_title:'Activité horaire · {name}',
      grp_series_title:'Détections dans le temps · {name}',
      grp_series_families:'Détections par famille · {name}',
      grp_heatmap_title:'Heatmap journalière · {name}',
      grp_breakdown_title:'Répartition par espèce',
      grp_breakdown_species:'Espèce', grp_breakdown_count:'Détections', grp_breakdown_pct:'%',
      grp_breakdown_conf:'Confiance',
      grp_select_prompt:'Sélectionnez un ordre ou une famille pour analyser le groupe.',
      grp_narr_period:'Sur la période {from} → {to}, le groupe <strong>{name}</strong> compte {species} espèces pour {total} détections.',
      grp_narr_dominant:'L\'espèce dominante est <strong>{species}</strong> avec {pct}% des détections.',
      grp_narr_peak:'Le pic d\'activité du groupe se situe à {time}.',
      // Ecological guilds
      guild_filter:'Guilde écologique', guild_all:'Toutes les guildes',
      guild_raptors:'Rapaces', guild_waterbirds:'Oiseaux d\'eau', guild_woodpeckers:'Pics',
      guild_passerines_forest:'Passereaux forestiers', guild_passerines_open:'Passereaux milieux ouverts',
      guild_thrushes_chats:'Grives et gobemouches', guild_warblers:'Fauvettes et pouillots',
      guild_corvids:'Corvidés', guild_swifts_swallows:'Martinets et hirondelles',
      guild_pigeons_doves:'Pigeons et tourterelles', guild_other:'Autres',
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
      quick_1d:'1j', quick_7d:'7j', quick_1m:'1m', quick_3m:'3m', quick_6m:'6m', quick_30d:'30j', quick_90d:'90j', quick_1y:'1an', quick_all:'Tout',
      // Stats
      per_day_avg:'/ jour (moy.)', trend:'Tendance',
      // Recordings
      best_recordings:'Meilleurs enregistrements', sort_conf_desc:'Confiance ↓', sort_date_desc:'Date ↓',
      sort_species_az:'Espèce A→Z', filter_species_ph:'Filtrer espèces…', clear_all:'Tout effacer',
      select_all:'Tout sélect.', deselect_all:'Tout désélect.', no_recordings:'Aucun enregistrement trouvé.', load_more:'Charger plus',
      remaining:'{n} restants', clean_audio:'Nettoyer le son', cleaned:'Nettoyé', cleaning:'Nettoyage…',
      force:'Force', spectral_sub:'filtre passe-haut + soustraction spectrale',
      af_gain:'Gain (dB)', af_highpass:'Passe-haut (Hz)', af_lowpass:'Passe-bas (Hz)', af_off:'Off',
      af_file_info:'Infos fichier', af_duration:'Durée', af_type:'Type', af_size:'Taille',
      af_sample_rate:'Fréq. échantillonnage', af_channels:'Canaux', af_file_path:'Chemin',
      af_mono:'Mono', af_stereo:'Stéréo', af_filters:'Filtres audio',
      // Model monitoring
      mod_title:'Monitoring modèle', mod_current:'Modèle actif', mod_detections:'Détections',
      mod_species:'Espèces', mod_confidence:'Confiance moy.', mod_rate:'Rythme',
      mod_per_hour:'/h', mod_conf_dist:'Distribution confiance',
      mod_top_species:'Top espèces', mod_trend:'Tendance 7j', mod_no_data:'Pas de données',
      mod_today:'Auj.', mod_7d:'7j', mod_30d:'30j',
      cmp_title:'Comparaison de périodes', cmp_split_date:'Date pivot',
      cmp_before:'Avant', cmp_after:'Après', cmp_det_day:'Dét./jour',
      cmp_species_gained:'Espèces gagnées', cmp_species_lost:'Espèces perdues',
      cmp_nocturnal:'Détections nocturnes', cmp_nocturnal_sub:'22h – 4h',
      cmp_none:'Aucune', cmp_per_day:'/j', cmp_change:'Variation',
      cmp_species_detail:'Comparaison par espèce', cmp_count:'Nb',
      // Delete management
      del_manage:'Gérer les détections', del_this:'Supprimer cette détection',
      del_all:'Supprimer tout', del_confirm_title:'Suppression irréversible',
      del_confirm_body:'Cette action supprimera {count} détections et tous les fichiers audio pour « {name} ». Cette action est irréversible.',
      del_type_name:'Tapez « {name} » pour confirmer :',
      del_permanently:'Supprimer définitivement', cancel:'Annuler',
      del_one_confirm:'Supprimer la détection du {date} à {time} (confiance : {conf}) ?\n\nLe fichier audio sera aussi supprimé.',
      del_success:'détections supprimées', del_file_errors:'fichiers non supprimés',
      del_done_title:'Suppression terminée', del_records_removed:'Détections supprimées',
      del_files_removed:'Fichiers supprimés', del_close:'Fermer',
      // Species detail
      avg_conf_short:'Confiance moy.', days_detected:'Jours détectés',
      activity_30d:'Activité — 30 jours', conf_distribution:'Distribution de confiance',
      activity_month_hour:'Activité saisonnière par heure', description:'Description', description_en:'Description (English)',
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
      all_rarities:'Toutes les raretés', updated_at:'Mis à jour', ebird_notable_title:'eBird — Observations notables', bw_period_today:'Auj.', bw_period_week:'7j', bw_period_month:'30j', bw_period_all:'Tout', unit_d:'j', unit_h:'h', unit_m:'m',
      no_notable_obs:'Aucune observation notable ces 7 derniers jours.',
      quick_today:'Auj.',
      // System tabs & health
      sys_tab_health:'Santé', sys_tab_model:'Modèle', sys_tab_data:'Données', sys_tab_external:'Externe',
      sys_health_title:'Santé du système', sys_cpu:'CPU', sys_ram:'RAM', sys_disk:'Disque',
      sys_temp:'Température', sys_fan:'Ventilateur', sys_uptime_label:'Uptime', sys_load:'Charge',
      sys_cores:'cœurs',
      sys_services_title:'Services', sys_svc_logs:'Journaux', sys_svc_no_logs:'Aucun journal',
      sys_confirm_stop:'Confirmer l\'arrêt', sys_confirm_stop_msg:'Arrêter le service « {name} » ? Cela peut interrompre l\'analyse.',
      sys_cancel:'Annuler', sys_svc_starting:'Démarrage…', sys_svc_stopping:'Arrêt…',
      sys_analysis_title:'Analyse en cours', sys_backlog:'Backlog', sys_lag:'Retard',
      sys_inference:'Inférence', sys_model_active:'Modèle actif',
      sys_files_pending:'fichiers en attente', sys_seconds:'secondes', sys_minutes:'min',
      sys_audio_title:'Audio', sys_rec_card:'Carte d\'entrée', sys_channels_label:'Canaux', sys_format:'Format',
      sys_backup_title:'Sauvegarde', sys_backup_dest:'Destination', sys_backup_mount:'Montage', sys_last_backup:'Dernier backup',
      sys_backup_size:'Taille', sys_mounted:'Monté', sys_not_mounted:'Non monté', sys_not_configured:'Non configuré',
      set_backup:'Sauvegarde', set_backup_dest:'Destination', set_backup_content:'Contenu à sauvegarder',
      set_backup_dest_local:'Disque USB / Local', set_backup_dest_smb:'Partage SMB/CIFS', set_backup_dest_nfs:'Montage NFS',
      set_backup_dest_sftp:'SFTP', set_backup_dest_s3:'Amazon S3', set_backup_dest_gdrive:'Google Drive',
      set_backup_dest_webdav:'WebDAV', set_backup_content_db:'Base de données', set_backup_content_audio:'Fichiers audio',
      set_backup_content_config:'Configuration', set_backup_content_all:'Tout sauvegarder',
      set_backup_path:'Chemin / Point de montage', set_backup_host:'Serveur', set_backup_port:'Port',
      set_backup_user:'Utilisateur', set_backup_pass:'Mot de passe', set_backup_share:'Partage',
      set_backup_bucket:'Bucket', set_backup_region:'Région', set_backup_access_key:'Clé d\'accès',
      set_backup_secret_key:'Clé secrète', set_backup_remote_path:'Chemin distant',
      set_backup_schedule:'Planification', set_backup_schedule_manual:'Manuel uniquement',
      set_backup_schedule_daily:'Quotidien', set_backup_schedule_weekly:'Hebdomadaire',
      set_backup_schedule_time:'Heure de sauvegarde', set_backup_retention:'Rétention (jours)',
      set_backup_run_now:'Lancer maintenant', set_backup_running:'Sauvegarde en cours…',
      set_backup_save:'Enregistrer la configuration backup',
      set_backup_saved:'Configuration backup enregistrée',
      set_backup_last_status:'Dernier statut', set_backup_never:'Jamais exécuté',
      set_backup_success:'Succès', set_backup_failed:'Échoué',
      set_backup_gdrive_folder:'ID du dossier Google Drive',
      set_backup_state_running:'En cours', set_backup_state_completed:'Terminé',
      set_backup_state_failed:'Échoué', set_backup_state_stopped:'Arrêté',
      set_backup_state_paused:'En pause',
      set_backup_step:'Étape', set_backup_started:'Démarré il y a',
      set_backup_pause:'Pause', set_backup_resume:'Reprendre', set_backup_stop:'Arrêter',
      set_backup_stop_confirm:'Arrêter le backup en cours ? (rsync reprendra au prochain lancement)',
      set_backup_transferred:'Transféré', set_backup_disk_free:'Espace libre',
      sys_network_title:'Réseau', sys_hostname:'Nom d\'hôte', sys_ip:'Adresse IP',
      sys_gateway:'Passerelle', sys_internet:'Internet',
      sys_nas_ping:'Ping NAS', sys_reachable:'Joignable', sys_unreachable:'Injoignable',
      sys_hardware_title:'Matériel',
      // UI labels
      nav_prev_day:'Jour précédent', nav_next_day:'Jour suivant',
      select_species_prompt:'Sélectionnez une espèce', listen_spectro_hint:'pour écouter et voir le spectrogramme',
      next_det_audio:'Prochaine détection avec audio →',
      download:'Télécharger', download_audio:'Télécharger l\'audio',
      ebird_export:'Export eBird',
      click_to_edit_value:'Cliquer pour saisir une valeur',
      search_filter_ph:'filtrer…', search_species_ph:'Rechercher… (appuyez /)',
      fft_analysis:'Analyse FFT…',
      // System — eBird / BirdWeather
      ebird_api_missing:'Clé API manquante',
      ebird_enable_text:'Pour activer cette section, obtenez une clé gratuite sur',
      ebird_then_configure:'puis configurez-la sur le Pi :',
      ebird_add_env:'Ajouter :', ebird_your_key:'votre_cle',
      ebird_no_notable:'Aucune observation notable ces 7 derniers jours.',
      ebird_see_on:'Voir sur eBird', bw_see_on:'Voir sur BirdWeather',
      bw_add_in:'Ajouter dans', bw_id_in_url:'L\'ID est visible dans l\'URL :',
      top_detected:'Top espèces détectées',
      detected_locally:'Également détecté localement', not_detected_locally:'Pas détecté localement',
      no_rarities_detected:'Aucune rareté détectée récemment',
      search_placeholder:'Rechercher une espèce\u2026',
      // Lifers
      lifers_label:'Lifers', no_lifers:'Aucun lifer pour cette date',
      // Morning summary (legacy)
      morning_summary:'Quoi de neuf', new_today:'Nouvelles aujourd\'hui', best_detection:'Meilleure détection',
      vs_yesterday:'vs hier', no_new_species:'Aucune nouvelle espèce',
      // What's New module
      wn_title:'Quoi de neuf',
      wn_level_alerts:'Alertes', wn_level_phenology:'Phénologie', wn_level_context:'Contexte du jour',
      wn_card_out_of_season:'Espèce hors-saison', wn_card_activity_spike:'Pic d\'activité',
      wn_card_species_return:'Retour après absence', wn_card_first_of_year:'Première de l\'année',
      wn_card_species_streak:'Présence consécutive', wn_card_seasonal_peak:'Pic saisonnier',
      wn_card_dawn_chorus:'Chorus auroral', wn_card_acoustic_quality:'Qualité acoustique',
      wn_card_species_richness:'Richesse spécifique', wn_card_moon_phase:'Phase lunaire',
      wn_insuf_label:'Données insuffisantes',
      wn_insuf_needsWeek:'Cette carte nécessite au moins 7 jours de détections. Elle s\'activera automatiquement une fois cette période écoulée.',
      wn_insuf_needsTwoWeeks:'Cette carte nécessite au moins 15 jours de détections pour identifier les absences significatives.',
      wn_insuf_needsMonth:'Cette carte nécessite au moins 28 jours de données pour calculer une ligne de base fiable.',
      wn_insuf_needsSeason:'Cette carte nécessite au moins un an de données pour comparer les pics saisonniers.',
      wn_insuf_needsGPS:'Coordonnées GPS non configurées. Renseignez LATITUDE et LONGITUDE dans /etc/birdnet/birdnet.conf.',
      wn_insuf_tooEarly:'Pas encore assez de détections aujourd\'hui. Revenez dans quelques heures.',
      wn_moon_new_moon:'Nouvelle lune', wn_moon_waxing_crescent:'Premier croissant',
      wn_moon_first_quarter:'Premier quartier', wn_moon_waxing_gibbous:'Gibbeuse croissante',
      wn_moon_full_moon:'Pleine lune', wn_moon_waning_gibbous:'Gibbeuse décroissante',
      wn_moon_last_quarter:'Dernier quartier', wn_moon_waning_crescent:'Dernier croissant',
      wn_migration_favorable:'Migration favorable', wn_migration_moderate:'Migration modérée', wn_migration_limited:'Migration limitée',
      wn_quality_good:'Bonne', wn_quality_moderate:'Modérée', wn_quality_poor:'Mauvaise',
      wn_trend_above:'Au-dessus', wn_trend_normal:'Normal', wn_trend_below:'En-dessous',
      wn_spike_ratio:'× la moyenne', wn_streak_days:'jours consécutifs', wn_absent_days:'jours d\'absence',
      wn_species_detected:'espèces détectées', wn_detections:'détections', wn_vs_avg:'vs moy.',
      wn_illumination:'Illumination', wn_acceptance_rate:'Taux d\'acceptation', wn_strong_detections:'Détections solides',
      // Phenology & quick play
      phenology:'Phénologie', first_arrival:'Première arrivée', last_departure:'Dernier départ', quick_play:'Écoute rapide',
      // Validation
      validation_confirmed:'Confirmée', validation_doubtful:'Douteuse', validation_rejected:'Rejetée', validation_unreviewed:'Non vérifiée',
      hide_rejected:'Masquer rejetées', validation_stats:'Statistiques de validation',
      // Timeline
      tl_title:'Journal du jour', tl_notable:'événements notables', tl_full_view:'Vue complète',
      tl_see_full:'Voir la timeline complète', tl_loading:'Chargement…',
      tl_prev_day:'Jour précédent', tl_next_day:'Jour suivant',
      tl_species:'espèces', tl_detections:'détections', tl_chronology:'Chronologie des événements',
      tl_see_species:'Voir la fiche espèce', tl_see_today:'Voir le jour', tl_listen:'Écouter', tl_validate:'Valider',
      tl_density_label:'Intensité des détections', tl_density_label_short:'Oiseaux', tl_now:'maintenant', tl_drag_hint:'glisser pour zoomer',
      tl_type_nocturnal:'🌙 Nocturne', tl_type_rare:'⭐ Rare', tl_type_firstyear:'🌱 1ère de l\'année',
      tl_type_firstday:'🐦 1ère diurne', tl_type_best:'🎵 Meilleure', tl_type_out_of_season:'⚠️ Hors-saison', tl_type_species_return:'🔄 Retour', tl_type_top_species:'🐦 Espèces',
      tl_density_0:'Très peu', tl_density_1:'Peu', tl_density_2:'Normal', tl_density_3:'Plus', tl_density_4:'Maximum', tl_density_5:'Tout',
      tl_tag_nocturnal:'Nocturne', tl_tag_strict_nocturnal:'Nocturne strict',
      tl_tag_migration:'Migration', tl_tag_out_of_season:'Hors-saison',
      tl_tag_rare:'Rare', tl_tag_firstyear:'1ère de l\'année', tl_tag_firstday:'1ère diurne', tl_tag_best:'Meilleure confiance',
      tl_tag_species_return:'Retour', tl_tag_activity_spike:'Pic d\'activité', tl_tag_top_species:'Vedette du jour',
      tl_sunrise:'Lever', tl_sunset:'Coucher', tl_confidence:'Confiance',
    },

    en: {
      _meta: { lang:'en', label:'English', flag:'🇬🇧' },
      nav_sec_realtime:'Live', nav_sec_history:'History', nav_sec_species:'Species', nav_sec_insights:'Insights', nav_sec_system:'Station',
      nav_sec_observe:'Observe', nav_sec_explore:'Explore',
      nav_overview:'Home', nav_today:'Today', nav_recent:'Activity', nav_review:'To review',
      nav_detections:'Detections', nav_species:'Species',
      nav_biodiversity:'Biodiversity', nav_rarities:'Rarities', nav_stats:'Statistics',
      nav_system:'Monitoring', nav_analyses:'Analysis', nav_models:'Models', nav_terminal:'Terminal', nav_spectrogram:'Live', nav_recordings:'Recordings', nav_gallery:'Best catches', nav_settings:'Configuration', nav_timeline:'Calendar', nav_calendar:'Calendar', nav_log:'Live log',
      log_live:'Live', log_paused:'Paused', log_disconnected:'Disconnected', log_pause:'Pause', log_resume:'Resume', log_clear:'Clear', log_errors:'Errors', log_lines:'Lines', log_all:'All', log_waiting:'Waiting for logs...',
      gallery_title:'Best catches', gallery_tab_best:'Best', gallery_tab_library:'Audio library', gallery_delete:'Delete', gallery_delete_confirm:'Delete this detection and its files?', top_detections_per_species:'top detections',
      set_location:'Location', set_site_name:'Site name', set_site_brand:'Brand name (header)', set_latitude:'Latitude', set_longitude:'Longitude',
      set_model:'Detection model', set_model_choice:'AI Model', set_species_freq_thresh:'Species frequency threshold',
      set_analysis:'Analysis', set_params:'Parameters', set_shared_params:'Shared parameters', set_confidence:'Confidence', set_birdnet_conf:'BirdNET confidence', set_perch_conf:'Perch confidence', set_perch_margin:'Perch margin (top1-top2)', set_sensitivity:'Sensitivity',
      set_language:'Species language', set_notifications:'Notifications',
      set_notify_each:'Notify each detection', set_notify_new_species:'Notify new species (never seen)',
      set_notify_new_daily:'Notify first species of the day', set_weekly_report:'Weekly report',
      set_notif_urls:'Notification URLs (Apprise)', set_notif_urls_help:'One URL per line. Examples:',
      set_notif_title:'Notification title', set_notif_body:'Message body',
      set_notif_body_help:'Variables: $comname, $sciname, $confidence, $date, $time',
      set_notif_test:'Test', set_notif_testing:'Sending…', set_notif_test_ok:'Notification sent!',
      set_notif_test_fail:'Failed: {error}', set_notif_cooldown:'Min. delay between notifications (seconds)',
      set_notif_no_urls:'No URLs configured — notifications will not be sent.',
      set_alerts_title:'System alerts', set_alerts_desc:'Get notified when a critical threshold is exceeded.',
      set_notif_events_title:'Notification events', set_notif_events_desc:'Check the events you want to receive notifications for.',
      set_notif_cat_birds:'Species detections', set_notif_cat_system:'System monitoring',
      set_alert_temp_warn:'Temperature warning', set_alert_temp_crit:'Temperature critical',
      set_alert_disk_warn:'Disk space warning', set_alert_ram_warn:'RAM warning',
      set_alert_backlog:'Analysis backlog', set_alert_no_det:'Detection silence',
      set_alert_svc_down:'Alert when a critical service goes down',
      set_notif_cat_bird_smart:'Smart bird alerts',
      set_alert_influx:'Unusual influx (>3x average)', set_alert_missing:'Missing common species (after noon)', set_alert_rare_visitor:'Rare visitor detected',
      set_tab_detection:'Detection', set_tab_audio:'Audio', set_tab_notif:'Notifications', set_tab_station:'Station', set_tab_services:'Services', set_tab_species:'Species', set_tab_system:'System', set_tab_backup:'Backup', set_tab_database:'Database', set_tab_terminal:'Terminal',
      bkp_init:'Initialisation', bkp_db:'Database', bkp_config:'Configuration', bkp_projects:'Projects', bkp_audio:'BirdSongs', bkp_upload:'Upload', bkp_mount:'Mounting', bkp_done:'Done', bkp_stopped_by_user:'Stopped by user', bkp_starting:'Starting…', bkp_next_run:'Next', bkp_no_schedule:'No schedule — manual mode', bkp_history:'History',
      share:'Share', analyze_deep:'Deep analysis', fav_add:'Add to favorites', fav_remove:'Remove from favorites', nav_favorites:'Favorites', fav_total:'Total favorites', fav_active_today:'Active today', fav_total_dets:'Total detections', fav_today_dets:'Today\'s detections', fav_added:'Added on', fav_last_seen:'Last seen', fav_first_seen:'First seen', fav_avg_conf:'Avg confidence', fav_empty:'No favorites — add species with ☆', fav_sort_name:'Name', fav_sort_recent:'Recent', fav_sort_count:'Detections', photo_ban:'Ban', photo_set_preferred:'Set as default', photo_banned:'Photo banned', photo_reset:'Reset', fav_only:'Favorites only', phenology_calendar:'Phenology calendar', notifications:'Notifications', wn_empty:'Nothing new',
      set_save:'Save', set_saved:'Configuration saved successfully', set_defaults:'Defaults', set_defaults_confirm:'Reset all detection parameters to their default values?', set_defaults_applied:'Default values applied — click Save to confirm',
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
      set_model_desc_perch:'Google Perch V2 — 10,340 birds among 15K total species',
      set_model_desc_perch_fp16:'Google — 10,340 birds, ~384 ms on Pi 5. Near-perfect quality vs original (top-1 100%, top-5 99%).',
      set_model_desc_perch_dynint8:'Google — 10,340 birds, ~299 ms on Pi 5, ~700 ms on Pi 4. 4x lighter (top-1 93%).',
      set_model_desc_perch_original:'Google — 10,340 birds, unmodified reference. Most accurate but heaviest (~435 ms on Pi 5).',
      set_model_desc_go:'BirdNET-Go — experimental variant',
      set_restart_confirm:'Restart services to apply?', set_save_restart:'Save & restart',
      today:'Today', this_week:'This week', this_month:'This month', all_time:'All time',
      detections:'Detections', species:'Species', avg_confidence:'Avg confidence',
      last_detection:'Last detection', top_species:'Top species',
      activity_7d:'7-day activity', activity_today:'Today\'s activity',
      last_hour:'Last hour', new_species:'New species', rare_today:'Rare species today',
      recent_detections:'Recent detections', today_log:"Today's log",
      no_data:'No data', loading:'Loading…', error:'Error', network_error:'Network error',
      date:'Date', time:'Time', species_name:'Species', scientific_name:'Scientific name',
      confidence:'Confidence', audio:'Audio', play:'Play',
      filter_species:'Filter by species', filter_order:'Taxonomic order', filter_family:'Family',
      all_orders:'All orders', all_families:'All families',
      filter_date_from:'From', filter_date_to:'To',
      filter_confidence:'Min. confidence', all_species:'All species',
      apply_filter:'Apply', reset_filter:'Reset', default_btn:'Default',
      prev_page:'← Previous', next_page:'Next →', page:'Page', of:'of', results:'results',
      species_detail:'Species detail', first_detection:'First detected', last_seen:'Last seen',
      total_detections:'Total detections', max_confidence:'Max confidence',
      activity_by_hour:'Hourly activity', monthly_presence:'Monthly presence',
      external_links:'External links', listen_on:'Listen on', observe_on:'Observe on',
      species_x_month:'Species by month', richness_per_day:'Daily richness',
      heatmap_hour_day:'Activity hour × day',
      kb_shortcuts_hint:'Space = play, ← → = navigate',
      db_tables:'Tables', db_refresh:'Refresh', db_schema:'Schema', db_query:'SQL Query', db_exec:'Execute', db_executing:'Executing...', db_readonly:'Read-only — SELECT, PRAGMA, WITH only', db_rows:'{n} row(s)', db_col:'Column', db_type:'Type', db_new:'New',
      dual_model:'Dual-model', dual_desc:'Analyze each file with two models in parallel', secondary_model:'Secondary model', dual_active:'{model} active', dual_wait:'Secondary model will load on next cycle (~5 min).', dual_status_active:'active', dual_status_primary:'Primary', dual_status_secondary:'Secondary',
      audio_profile:'Active profile', audio_strategy:'Multi-channel strategy', audio_strategy_2ch:'Available only with 2 microphones.', audio_save:'Save', audio_refresh:'Refresh', audio_no_device:'No audio device detected.', audio_wiring:'Microphone wiring', audio_sr_note:'Output sample rate: 32,000 Hz (required by Perch V2, not configurable)',
      cal_title:'Inter-channel calibration', cal_need_2ch:'Calibration requires 2 microphones.', cal_expired:'Calibration expired (> 7 days). Recalibration recommended.', cal_not_done:'Both channels are not calibrated.', cal_instructions:'Place both microphones side by side (< 5 cm), same direction. Capture lasts 10 seconds.', cal_start:'Start calibration', cal_capturing:'Capturing... (10 seconds)', cal_apply:'Apply and save', cal_retry:'Retry',
      notif_channel:'Notification channel', notif_on:'Notifications active', notif_off:'Notifications disabled', notif_save:'Save', notif_test:'Test', notif_rare:'Rare species', notif_rare_desc:'Never seen or less than N total detections', notif_season:'First of season', notif_season_desc:'Not seen for N days', notif_season_days_label:'Absent since', notif_new:'New species — Never detected', notif_daily:'First of day', notif_daily_warn:'noisy: ~50 notifs/day', notif_each:'Every detection', notif_each_warn:'very noisy: ~1000+ notifs/day', notif_favorites:'Favorites', notif_favorites_desc:'Notify when a favorite species is detected (once per day per species)', notif_report:'Weekly report', notif_bird_alerts:'Bird alerts', notif_sys_alerts:'System alerts', unit_days:'days', audio_overlap:'Window overlap',
      review_suspects:'{n} suspects', review_total:'total', review_selected:'{n} selected', review_select_all:'Select all', review_deselect:'Deselect all', review_confirm:'Confirm', review_reject:'Reject', review_reject_rule:'Reject by rule', review_confirm_q:'Confirm {n} detections?', review_reject_q:'Reject {n} detections?', review_reject_rule_q:'Reject {n} "{rule}" detections?', review_none:'No suspect detections for this period.', review_showing:'shown', review_show_more:'Show more', review_confirmed_msg:'Confirmed', review_rejected_msg:'Rejected', review_doubtful_msg:'Doubtful', review_action_error:'Validation error', review_detections:'detections',
      review_purge:'Purge rejected', review_purge_title:'Delete rejected detections', review_purge_warning:'The following detections will be permanently deleted from the database and their audio files will be removed. This action cannot be undone.', review_purge_confirm:'Delete permanently', review_delete_done:'Deletion complete',
      models_detections:'detections', models_species:'species', models_avg_conf:'avg conf.', models_daily:'Detections per day and model', models_exclusive:'Exclusive species', models_overlap:'Species detected by both models', models_ratio:'Ratio', models_none:'No exclusive species',
      species_tab:'Species inclusion / exclusion', species_desc:'Control which species are detected. One scientific name per line.', species_include_desc:'If filled, only these species will be detected.', species_exclude_desc:'These species will be ignored.',
      fp_preview:'Preview', fp_recording:'Recording (3s)...', fp_title:'Before / After filters', fp_before:'Before (raw signal)', fp_after:'After (filters applied)', fp_hint:'Spectrogram generated from 3 seconds of mic input. Run again to refresh.',
      audio_1ch:'1 microphone (channel 0)', audio_2ch:'2 microphones (channels 0+1)', audio_highpass:'High-pass filter', audio_lowpass:'Low-pass filter', audio_lp_birds:'Birds', audio_lp_wide:'Wide', audio_lp_full:'Full', audio_denoise:'Spectral noise reduction', audio_denoise_desc:'Attenuates constant background noise (wind, traffic, insects) using spectral gating. Requires scipy + noisereduce.', audio_denoise_light:'Light', audio_denoise_strong:'Strong', audio_denoise_warn:'High values may attenuate faint bird calls.', audio_rms:'RMS normalization', audio_levels:'Real-time input levels', audio_test:'Audio test (5 seconds)', audio_test_btn:'Test audio', audio_duplicate:'Duplicate', audio_delete:'Delete', audio_calm:'Calm', audio_road:'Road', audio_urban:'Urban', audio_cpu_warn:'High CPU load on RPi5', audio_threshold:'Threshold', audio_max_det:'max total detections', audio_target:'Target',
      audio_enabled:'Enabled', audio_start:'Start', audio_stop:'Stop', audio_click_start:'Click Start to display real-time audio levels.', audio_detected:'Detected audio devices', audio_sub_device:'Device', audio_sub_profile:'Profile & Settings', audio_sub_cal:'Calibration', audio_sub_monitor:'Monitoring', audio_last_cal:'Last calibration', audio_ch0:'Channel 0 (CH0)', audio_ch1:'Channel 1 (CH1)', audio_gain_comp:'Compensatory gain', audio_sum:'Sum', audio_sum_desc:'Combine both signals (SNR gain +3dB)', audio_max:'Maximum', audio_max_desc:'Keep highest score (maximize recall)', audio_vote:'Vote', audio_vote_desc:'Require detection on both channels (reduce false positives)',
      ag_title:'Adaptive normalization', ag_desc:'Adjusts software gain based on ambient noise. Observer mode: calculates without applying.', ag_enabled:'Enable', ag_mode:'Mode', ag_conservative:'Conservative', ag_balanced:'Balanced', ag_night:'Night', ag_observer:'Observer only', ag_apply:'Apply gain', ag_min:'Min gain', ag_max:'Max gain', ag_interval:'Interval', ag_history:'History', ag_target:'Target floor', ag_clip_guard:'Clip guard', ag_hold:'Activity hold', ag_state:'Current state', ag_noise_floor:'Noise floor', ag_activity:'Activity', ag_peak:'Peak', ag_current_gain:'Current gain', ag_recommended:'Recommended gain', ag_reason:'Reason', ag_disabled:'Disabled', ag_stable:'Stable', ag_step_up:'Stepping up', ag_step_down:'Stepping down', ag_clip:'Clip guard', ag_activity_hold:'Hold (activity)', ag_observer_mode:'Observing', ag_init:'Initializing', ag_not_enough:'Not enough data', ag_advanced:'Advanced settings', ag_noise_pct:'Noise percentile',
      retention_days:'Audio retention (days)', terminal_desc:'Bash — supports Claude Code', spectro_live:'Live Mic', spectro_clips:'Detection clips',
      audio_cleaning:'Cleaning audio…', audio_analyzing:'Analyzing audio…', audio_unavailable:'Audio file unavailable', audio_not_found:'Audio file not found (404)', audio_decode_error:'Audio decoding error', audio_no_file:'No audio file recorded', audio_bad_name:'Unrecognized file name', audio_clean_progress:'Cleaning…', audio_clean_done:'Cleaned', audio_clean_btn:'Clean audio', no_data:'No data', svc_engine:'Detection engine', svc_recording:'Audio capture', svc_web:'Web server', svc_terminal:'Web terminal', sys_tab_health:'Health', sys_tab_model:'Model', sys_tab_data:'Data', sys_tab_external:'External',
      shannon_index:'Shannon index', shannon_evenness:'Evenness', personal_notes:'Personal notes',
      bio_taxonomy_orders:'Distribution by order', bio_taxonomy_families:'Detected families',
      rare_species:'Rare species', rare_desc:'Species with fewer than {n} detections',
      first_seen:'First seen', detections_count:'Detections',
      top_by_count:'Ranking by detections', top_by_confidence:'Ranking by confidence',
      confidence_distrib:'Confidence distribution', activity_calendar:'Activity calendar',
      monthly_totals:'Monthly totals',
      freq_range:'Frequency range',
      nav_weather:'Weather & Birds', weather_activity:'Weather & Activity', weather_correlation:'Weather/activity correlation', weather_best:'Best conditions: ~{temp}°C, ~{precip}mm rain/day', weather_best_full:'Best conditions: ~{temp}°C, ~{precip}mm rain, wind ~{wind}km/h', weather_forecast:'Tomorrow\'s forecast', weather_trend:'expected activity {pct}%', weather_top_species:'Species by weather conditions', temperature:'Temperature', precipitation:'Precipitation', wind:'Wind',
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
      circadian_comparison:'Circadian comparison',
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
      grp_mode_species:'By species', grp_mode_taxo:'By taxonomic group',
      grp_title_order:'Order analysis · {name}', grp_title_family:'Family analysis · {name}',
      grp_kpi_species:'Species in group', grp_kpi_detections:'Total detections',
      grp_kpi_conf:'Avg confidence', grp_kpi_days:'Active days', grp_kpi_avg_day:'Avg / day',
      grp_polar_title:'Hourly activity · {name}',
      grp_series_title:'Detections over time · {name}',
      grp_series_families:'Detections by family · {name}',
      grp_heatmap_title:'Daily heatmap · {name}',
      grp_breakdown_title:'Species breakdown',
      grp_breakdown_species:'Species', grp_breakdown_count:'Detections', grp_breakdown_pct:'%',
      grp_breakdown_conf:'Confidence',
      grp_select_prompt:'Select an order or family to analyse the group.',
      grp_narr_period:'Over the period {from} → {to}, the group <strong>{name}</strong> has {species} species with {total} detections.',
      grp_narr_dominant:'The dominant species is <strong>{species}</strong> with {pct}% of detections.',
      grp_narr_peak:'The group\'s peak activity is at {time}.',
      // Ecological guilds
      guild_filter:'Ecological guild', guild_all:'All guilds',
      guild_raptors:'Raptors', guild_waterbirds:'Waterbirds', guild_woodpeckers:'Woodpeckers',
      guild_passerines_forest:'Forest passerines', guild_passerines_open:'Open-land passerines',
      guild_thrushes_chats:'Thrushes & chats', guild_warblers:'Warblers',
      guild_corvids:'Corvids', guild_swifts_swallows:'Swifts & swallows',
      guild_pigeons_doves:'Pigeons & doves', guild_other:'Other',
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
      quick_1d:'1d', quick_7d:'7d', quick_1m:'1m', quick_3m:'3m', quick_6m:'6m', quick_30d:'30d', quick_90d:'90d', quick_1y:'1yr', quick_all:'All',
      per_day_avg:'/ day (avg)', trend:'Trend',
      best_recordings:'Best recordings', sort_conf_desc:'Confidence ↓', sort_date_desc:'Date ↓',
      sort_species_az:'Species A→Z', filter_species_ph:'Filter species…', clear_all:'Clear all',
      select_all:'Select all', deselect_all:'Deselect all', no_recordings:'No recordings found.', load_more:'Load more',
      remaining:'{n} remaining', clean_audio:'Clean audio', cleaned:'Cleaned', cleaning:'Cleaning…',
      force:'Strength', spectral_sub:'high-pass filter + spectral subtraction',
      af_gain:'Gain (dB)', af_highpass:'HighPass (Hz)', af_lowpass:'LowPass (Hz)', af_off:'Off',
      af_file_info:'File info', af_duration:'Duration', af_type:'Type', af_size:'Size',
      af_sample_rate:'Sample rate', af_channels:'Channels', af_file_path:'Path',
      af_mono:'Mono', af_stereo:'Stereo', af_filters:'Audio filters',
      mod_title:'Model monitoring', mod_current:'Active model', mod_detections:'Detections',
      mod_species:'Species', mod_confidence:'Avg confidence', mod_rate:'Rate',
      mod_per_hour:'/h', mod_conf_dist:'Confidence distribution',
      mod_top_species:'Top species', mod_trend:'7d trend', mod_no_data:'No data',
      mod_today:'Today', mod_7d:'7d', mod_30d:'30d',
      cmp_title:'Period comparison', cmp_split_date:'Split date',
      cmp_before:'Before', cmp_after:'After', cmp_det_day:'Det./day',
      cmp_species_gained:'Species gained', cmp_species_lost:'Species lost',
      cmp_nocturnal:'Nocturnal detections', cmp_nocturnal_sub:'10pm – 4am',
      cmp_none:'None', cmp_per_day:'/d', cmp_change:'Change',
      cmp_species_detail:'Per-species comparison', cmp_count:'Count',
      del_manage:'Manage detections', del_this:'Delete this detection',
      del_all:'Delete all', del_confirm_title:'Irreversible deletion',
      del_confirm_body:'This will delete {count} detections and all audio files for "{name}". This action cannot be undone.',
      del_type_name:'Type "{name}" to confirm:',
      del_permanently:'Delete permanently', cancel:'Cancel',
      del_one_confirm:'Delete detection from {date} at {time} (confidence: {conf})?\n\nThe audio file will also be deleted.',
      del_success:'detections deleted', del_file_errors:'files could not be deleted',
      del_done_title:'Deletion complete', del_records_removed:'Detections removed',
      del_files_removed:'Files removed', del_close:'Close',
      avg_conf_short:'Avg confidence', days_detected:'Days detected',
      activity_30d:'Activity — 30 days', conf_distribution:'Confidence distribution',
      activity_month_hour:'Seasonal activity by hour', description:'Description', description_en:'Description (English)',
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
      all_rarities:'All rarities', updated_at:'Updated', ebird_notable_title:'eBird — Notable observations', bw_period_today:'Today', bw_period_week:'7d', bw_period_month:'30d', bw_period_all:'All', unit_d:'d', unit_h:'h', unit_m:'m',
      no_notable_obs:'No notable observations in the last 7 days.',
      quick_today:'Today',
      sys_tab_health:'Health', sys_tab_model:'Model', sys_tab_data:'Data', sys_tab_external:'External',
      sys_health_title:'System Health', sys_cpu:'CPU', sys_ram:'RAM', sys_disk:'Disk',
      sys_temp:'Temperature', sys_fan:'Fan', sys_uptime_label:'Uptime', sys_load:'Load',
      sys_cores:'cores',
      sys_services_title:'Services', sys_svc_logs:'Logs', sys_svc_no_logs:'No logs',
      sys_confirm_stop:'Confirm Stop', sys_confirm_stop_msg:'Stop service "{name}"? This may interrupt analysis.',
      sys_cancel:'Cancel', sys_svc_starting:'Starting…', sys_svc_stopping:'Stopping…',
      sys_analysis_title:'Analysis Status', sys_backlog:'Backlog', sys_lag:'Lag',
      sys_inference:'Inference', sys_model_active:'Active Model',
      sys_files_pending:'files pending', sys_seconds:'seconds', sys_minutes:'min',
      sys_audio_title:'Audio', sys_rec_card:'Input Card', sys_channels_label:'Channels', sys_format:'Format',
      sys_backup_title:'Backup', sys_backup_dest:'Destination', sys_backup_mount:'Mount', sys_last_backup:'Last Backup',
      sys_backup_size:'Size', sys_mounted:'Mounted', sys_not_mounted:'Not Mounted', sys_not_configured:'Not configured',
      set_backup:'Backup', set_backup_dest:'Destination', set_backup_content:'Content to back up',
      set_backup_dest_local:'USB Disk / Local', set_backup_dest_smb:'SMB/CIFS Share', set_backup_dest_nfs:'NFS Mount',
      set_backup_dest_sftp:'SFTP', set_backup_dest_s3:'Amazon S3', set_backup_dest_gdrive:'Google Drive',
      set_backup_dest_webdav:'WebDAV', set_backup_content_db:'Database', set_backup_content_audio:'Audio files',
      set_backup_content_config:'Configuration', set_backup_content_all:'Back up everything',
      set_backup_path:'Path / Mount point', set_backup_host:'Server', set_backup_port:'Port',
      set_backup_user:'Username', set_backup_pass:'Password', set_backup_share:'Share',
      set_backup_bucket:'Bucket', set_backup_region:'Region', set_backup_access_key:'Access Key',
      set_backup_secret_key:'Secret Key', set_backup_remote_path:'Remote path',
      set_backup_schedule:'Schedule', set_backup_schedule_manual:'Manual only',
      set_backup_schedule_daily:'Daily', set_backup_schedule_weekly:'Weekly',
      set_backup_schedule_time:'Backup time', set_backup_retention:'Retention (days)',
      set_backup_run_now:'Run now', set_backup_running:'Backup in progress…',
      set_backup_save:'Save backup configuration',
      set_backup_saved:'Backup configuration saved',
      set_backup_last_status:'Last status', set_backup_never:'Never run',
      set_backup_success:'Success', set_backup_failed:'Failed',
      set_backup_gdrive_folder:'Google Drive folder ID',
      set_backup_state_running:'Running', set_backup_state_completed:'Completed',
      set_backup_state_failed:'Failed', set_backup_state_stopped:'Stopped',
      set_backup_state_paused:'Paused',
      set_backup_step:'Step', set_backup_started:'Started',
      set_backup_pause:'Pause', set_backup_resume:'Resume', set_backup_stop:'Stop',
      set_backup_stop_confirm:'Stop the running backup? (rsync will resume on next run)',
      set_backup_transferred:'Transferred', set_backup_disk_free:'Free space',
      sys_network_title:'Network', sys_hostname:'Hostname', sys_ip:'IP Address',
      sys_gateway:'Gateway', sys_internet:'Internet',
      sys_nas_ping:'NAS Ping', sys_reachable:'Reachable', sys_unreachable:'Unreachable',
      sys_hardware_title:'Hardware',
      nav_prev_day:'Previous day', nav_next_day:'Next day',
      select_species_prompt:'Select a species', listen_spectro_hint:'to listen and view the spectrogram',
      next_det_audio:'Next detection with audio →',
      download:'Download', download_audio:'Download audio',
      ebird_export:'eBird export',
      click_to_edit_value:'Click to enter a value',
      search_filter_ph:'filter…', search_species_ph:'Search… (press /)',
      fft_analysis:'FFT analysis…',
      ebird_api_missing:'API key missing',
      ebird_enable_text:'To enable this section, get a free key at',
      ebird_then_configure:'then configure it on the Pi:',
      ebird_add_env:'Add:', ebird_your_key:'your_key',
      ebird_no_notable:'No notable observations in the last 7 days.',
      ebird_see_on:'View on eBird', bw_see_on:'View on BirdWeather',
      bw_add_in:'Add in', bw_id_in_url:'The ID is visible in the URL:',
      top_detected:'Top detected species',
      detected_locally:'Also detected locally', not_detected_locally:'Not detected locally',
      no_rarities_detected:'No rarities detected recently',
      search_placeholder:'Search species\u2026',
      // Lifers
      lifers_label:'Lifers', no_lifers:'No lifers for this date',
      // Morning summary (legacy)
      morning_summary:'What\'s new', new_today:'New today', best_detection:'Best detection',
      vs_yesterday:'vs yesterday', no_new_species:'No new species',
      // What's New module
      wn_title:'What\'s New',
      wn_level_alerts:'Alerts', wn_level_phenology:'Phenology', wn_level_context:'Today\'s Context',
      wn_card_out_of_season:'Out-of-season species', wn_card_activity_spike:'Activity spike',
      wn_card_species_return:'Species returned', wn_card_first_of_year:'First of the year',
      wn_card_species_streak:'Consecutive presence', wn_card_seasonal_peak:'Seasonal peak',
      wn_card_dawn_chorus:'Dawn chorus', wn_card_acoustic_quality:'Acoustic quality',
      wn_card_species_richness:'Species richness', wn_card_moon_phase:'Moon phase',
      wn_insuf_label:'Insufficient data',
      wn_insuf_needsWeek:'This card requires at least 7 days of detections. It will activate automatically once this period has passed.',
      wn_insuf_needsTwoWeeks:'This card requires at least 15 days of detections to identify significant absences.',
      wn_insuf_needsMonth:'This card requires at least 28 days of data to compute a reliable baseline.',
      wn_insuf_needsSeason:'This card requires at least one year of data to compare seasonal peaks.',
      wn_insuf_needsGPS:'GPS coordinates not configured. Set LATITUDE and LONGITUDE in /etc/birdnet/birdnet.conf.',
      wn_insuf_tooEarly:'Not enough detections today yet. Check back in a few hours.',
      wn_moon_new_moon:'New moon', wn_moon_waxing_crescent:'Waxing crescent',
      wn_moon_first_quarter:'First quarter', wn_moon_waxing_gibbous:'Waxing gibbous',
      wn_moon_full_moon:'Full moon', wn_moon_waning_gibbous:'Waning gibbous',
      wn_moon_last_quarter:'Last quarter', wn_moon_waning_crescent:'Waning crescent',
      wn_migration_favorable:'Favorable migration', wn_migration_moderate:'Moderate migration', wn_migration_limited:'Limited migration',
      wn_quality_good:'Good', wn_quality_moderate:'Moderate', wn_quality_poor:'Poor',
      wn_trend_above:'Above', wn_trend_normal:'Normal', wn_trend_below:'Below',
      wn_spike_ratio:'× average', wn_streak_days:'consecutive days', wn_absent_days:'days absent',
      wn_species_detected:'species detected', wn_detections:'detections', wn_vs_avg:'vs avg.',
      wn_illumination:'Illumination', wn_acceptance_rate:'Acceptance rate', wn_strong_detections:'Strong detections',
      // Phenology & quick play
      phenology:'Phenology', first_arrival:'First arrival', last_departure:'Last departure', quick_play:'Quick play',
      // Validation
      validation_confirmed:'Confirmed', validation_doubtful:'Doubtful', validation_rejected:'Rejected', validation_unreviewed:'Unreviewed',
      hide_rejected:'Hide rejected', validation_stats:'Validation stats',
      // Timeline
      tl_title:'Daily Journal', tl_notable:'notable events', tl_full_view:'Full view',
      tl_see_full:'See full timeline', tl_loading:'Loading…',
      tl_prev_day:'Previous day', tl_next_day:'Next day',
      tl_species:'species', tl_detections:'detections', tl_chronology:'Event chronology',
      tl_see_species:'See species card', tl_see_today:'See this day', tl_listen:'Listen', tl_validate:'Validate',
      tl_density_label:'Detection intensity', tl_density_label_short:'Birds', tl_now:'now', tl_drag_hint:'drag to zoom',
      tl_type_nocturnal:'🌙 Nocturnal', tl_type_rare:'⭐ Rare', tl_type_firstyear:'🌱 First of year',
      tl_type_firstday:'🐦 First diurnal', tl_type_best:'🎵 Best detection', tl_type_out_of_season:'⚠️ Out of season', tl_type_species_return:'🔄 Return', tl_type_top_species:'🐦 Species',
      tl_density_0:'Very few', tl_density_1:'Few', tl_density_2:'Normal', tl_density_3:'More', tl_density_4:'Maximum', tl_density_5:'All',
      tl_tag_nocturnal:'Nocturnal', tl_tag_strict_nocturnal:'Strict nocturnal',
      tl_tag_migration:'Migration', tl_tag_out_of_season:'Out of season',
      tl_tag_rare:'Rare', tl_tag_firstyear:'First of year', tl_tag_firstday:'First diurnal', tl_tag_best:'Best confidence',
      tl_tag_species_return:'Return', tl_tag_activity_spike:'Activity spike', tl_tag_top_species:'Top species',
      tl_sunrise:'Sunrise', tl_sunset:'Sunset', tl_confidence:'Confidence',
    },

    de: {
      _meta: { lang:'de', label:'Deutsch', flag:'🇩🇪' },
      nav_sec_realtime:'Live', nav_sec_history:'Verlauf', nav_sec_species:'Arten', nav_sec_insights:'Analysen', nav_sec_system:'Station',
      nav_sec_observe:'Beobachten', nav_sec_explore:'Erkunden',
      nav_overview:'Startseite', nav_today:'Heute', nav_recent:'Aktivität', nav_review:'Zu prüfen',
      nav_detections:'Erkennungen', nav_species:'Arten',
      nav_biodiversity:'Biodiversität', nav_rarities:'Seltenheiten',
      nav_stats:'Statistiken', nav_system:'Monitoring', nav_analyses:'Analysen', nav_models:'Modelle', nav_terminal:'Terminal', nav_spectrogram:'Live', nav_recordings:'Aufnahmen', nav_gallery:'Beste Aufnahmen', nav_settings:'Konfiguration', nav_timeline:'Kalender', nav_calendar:'Kalender', nav_log:'Live-Log',
      log_live:'Live', log_paused:'Pausiert', log_disconnected:'Getrennt', log_pause:'Pause', log_resume:'Fortsetzen', log_clear:'Löschen', log_errors:'Fehler', log_lines:'Zeilen', log_all:'Alle', log_waiting:'Warten auf Logs...',
      gallery_title:'Beste Aufnahmen', gallery_tab_best:'Beste', gallery_tab_library:'Audiobibliothek', gallery_delete:'Löschen', gallery_delete_confirm:'Diese Erkennung und ihre Dateien löschen?', top_detections_per_species:'beste Erkennungen',
      set_location:'Standort', set_site_name:'Standortname', set_site_brand:'Markenname (Header)', set_latitude:'Breitengrad', set_longitude:'Längengrad',
      set_model:'Erkennungsmodell', set_model_choice:'KI-Modell', set_species_freq_thresh:'Artenhäufigkeitsschwelle',
      set_analysis:'Analyse', set_params:'Parameter', set_shared_params:'Gemeinsame Parameter', set_confidence:'Konfidenz', set_birdnet_conf:'BirdNET-Konfidenz', set_perch_conf:'Perch-Konfidenz', set_perch_margin:'Perch-Marge (Top1-Top2)', set_sensitivity:'Empfindlichkeit',
      set_language:'Artensprache', set_notifications:'Benachrichtigungen',
      set_notify_each:'Bei jeder Erkennung benachrichtigen', set_notify_new_species:'Neue Art benachrichtigen',
      set_notify_new_daily:'Erste Art des Tages benachrichtigen', set_weekly_report:'Wochenbericht',
      set_notif_urls:'Benachrichtigungs-URLs (Apprise)', set_notif_urls_help:'Eine URL pro Zeile. Beispiele:',
      set_notif_title:'Benachrichtigungstitel', set_notif_body:'Nachrichtentext',
      set_notif_body_help:'Variablen: $comname, $sciname, $confidence, $date, $time',
      set_notif_test:'Testen', set_notif_testing:'Wird gesendet…', set_notif_test_ok:'Benachrichtigung gesendet!',
      set_notif_test_fail:'Fehlgeschlagen: {error}', set_notif_cooldown:'Min. Verzögerung zwischen Benachrichtigungen (Sek.)',
      set_notif_no_urls:'Keine URLs konfiguriert — Benachrichtigungen werden nicht gesendet.',
      set_alerts_title:'Systemalarme', set_alerts_desc:'Benachrichtigung bei Überschreitung kritischer Schwellenwerte.',
      set_notif_events_title:'Benachrichtigungsereignisse', set_notif_events_desc:'Wählen Sie die Ereignisse, für die Sie benachrichtigt werden möchten.',
      set_notif_cat_birds:'Artenerkennung', set_notif_cat_system:'Systemüberwachung',
      set_alert_temp_warn:'Temperatur Warnung', set_alert_temp_crit:'Temperatur kritisch',
      set_alert_disk_warn:'Speicherplatz Warnung', set_alert_ram_warn:'RAM Warnung',
      set_alert_backlog:'Analyse-Rückstand', set_alert_no_det:'Erkennungsstille',
      set_alert_svc_down:'Alarm bei Ausfall eines kritischen Dienstes',
      set_notif_cat_bird_smart:'Intelligente Vogelalarme',
      set_alert_influx:'Ungewöhnlicher Zustrom (>3x Durchschnitt)', set_alert_missing:'Häufige Art fehlt (nach Mittag)', set_alert_rare_visitor:'Seltener Besucher entdeckt',
      set_tab_detection:'Erkennung', set_tab_audio:'Audio', set_tab_notif:'Benachrichtigungen', set_tab_station:'Station', set_tab_services:'Dienste', set_tab_species:'Arten', set_tab_system:'System', set_tab_backup:'Sicherung', set_tab_database:'Datenbank', set_tab_terminal:'Terminal',
      bkp_init:'Initialisierung', bkp_db:'Datenbank', bkp_config:'Konfiguration', bkp_projects:'Projekte', bkp_audio:'BirdSongs', bkp_upload:'Upload', bkp_mount:'Einbindung', bkp_done:'Fertig', bkp_stopped_by_user:'Vom Benutzer gestoppt', bkp_starting:'Wird gestartet…', bkp_next_run:'Nächster', bkp_no_schedule:'Kein Zeitplan — manueller Modus', bkp_history:'Verlauf',
      share:'Teilen', analyze_deep:'Tiefenanalyse', fav_add:'Zu Favoriten', fav_remove:'Aus Favoriten entfernen', nav_favorites:'Favoriten', fav_total:'Favoriten gesamt', fav_active_today:'Heute aktiv', fav_total_dets:'Erkennungen gesamt', fav_today_dets:'Erkennungen heute', fav_added:'Hinzugefügt am', fav_last_seen:'Zuletzt gesehen', fav_first_seen:'Erstmals gesehen', fav_avg_conf:'Ø Konfidenz', fav_empty:'Keine Favoriten — Arten mit ☆ hinzufügen', fav_sort_name:'Name', fav_sort_recent:'Aktuell', fav_sort_count:'Erkennungen', photo_ban:'Sperren', photo_set_preferred:'Als Standard', photo_banned:'Foto gesperrt', photo_reset:'Zurücksetzen', fav_only:'Nur Favoriten', phenology_calendar:'Phänologie-Kalender', notifications:'Benachrichtigungen', wn_empty:'Nichts Neues',
      set_save:'Speichern', set_saved:'Konfiguration erfolgreich gespeichert', set_defaults:'Standard', set_defaults_confirm:'Alle Erkennungsparameter auf Standardwerte zurücksetzen?', set_defaults_applied:'Standardwerte angewendet — klicken Sie Speichern zur Bestätigung',
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
      set_model_desc_perch:'Google Perch V2 — 10.340 Vögel unter 15K Gesamtarten',
      set_model_desc_perch_fp16:'Google — 10.340 Vögel, ~384 ms auf Pi 5. Nahezu perfekte Qualität (Top-1 100%, Top-5 99%).',
      set_model_desc_perch_dynint8:'Google — 10.340 Vögel, ~299 ms auf Pi 5, ~700 ms auf Pi 4. 4× leichter (Top-1 93%).',
      set_model_desc_perch_original:'Google — 10.340 Vögel, unveränderte Referenz. Am genauesten, aber am größten (~435 ms auf Pi 5).',
      set_model_desc_go:'BirdNET-Go — experimentelle Variante',
      set_restart_confirm:'Dienste neu starten um anzuwenden?', set_save_restart:'Speichern & Neustart',
      today:'Heute', this_week:'Diese Woche', this_month:'Diesen Monat', all_time:'Gesamt',
      detections:'Erkennungen', species:'Arten', avg_confidence:'Ø Konfidenz',
      last_detection:'Letzte Erkennung', top_species:'Top-Arten',
      activity_7d:'7-Tage-Aktivität', activity_today:'Aktivität heute',
      last_hour:'Letzte Stunde', new_species:'Neue Arten', rare_today:'Seltene Arten heute',
      recent_detections:'Letzte Erkennungen', today_log:'Tagesjournal',
      no_data:'Keine Daten', loading:'Laden…', error:'Fehler', network_error:'Netzwerkfehler',
      date:'Datum', time:'Uhrzeit', species_name:'Art', scientific_name:'Wissenschaftlicher Name',
      confidence:'Konfidenz', audio:'Audio', play:'Abspielen',
      filter_species:'Nach Art filtern', filter_order:'Taxonomische Ordnung', filter_family:'Familie',
      all_orders:'Alle Ordnungen', all_families:'Alle Familien',
      filter_date_from:'Von', filter_date_to:'Bis',
      filter_confidence:'Min. Konfidenz', all_species:'Alle Arten',
      apply_filter:'Anwenden', reset_filter:'Zurücksetzen', default_btn:'Standard',
      prev_page:'← Zurück', next_page:'Weiter →', page:'Seite', of:'von', results:'Ergebnisse',
      species_detail:'Artensteckbrief', first_detection:'Erste Erkennung', last_seen:'Zuletzt gesehen',
      total_detections:'Erkennungen gesamt', max_confidence:'Max. Konfidenz',
      activity_by_hour:'Aktivität pro Stunde', monthly_presence:'Monatliche Präsenz',
      external_links:'Externe Links', listen_on:'Anhören auf', observe_on:'Beobachten auf',
      species_x_month:'Arten pro Monat', richness_per_day:'Tagesvielfalt',
      heatmap_hour_day:'Aktivität Stunde × Tag',
      kb_shortcuts_hint:'Leertaste = Wiedergabe, ← → = Navigation',
      db_tables:'Tabellen', db_refresh:'Aktualisieren', db_schema:'Schema', db_query:'SQL-Abfrage', db_exec:'Ausführen', db_executing:'Wird ausgeführt...', db_readonly:'Nur Lesen — SELECT, PRAGMA, WITH', db_rows:'{n} Zeile(n)', db_col:'Spalte', db_type:'Typ', db_new:'Neu',
      dual_model:'Dual-Modell', dual_desc:'Jede Datei mit zwei Modellen parallel analysieren', secondary_model:'Sekundäres Modell', dual_active:'{model} aktiv', dual_wait:'Sekundärmodell wird beim nächsten Zyklus geladen (~5 Min.).', dual_status_active:'aktiv', dual_status_primary:'Primär', dual_status_secondary:'Sekundär',
      audio_profile:'Aktives Profil', audio_strategy:'Mehrkanalstrategie', audio_strategy_2ch:'Nur mit 2 Mikrofonen verfügbar.', audio_save:'Speichern', audio_refresh:'Aktualisieren', audio_no_device:'Kein Audiogerät erkannt.', audio_wiring:'Mikrofonverkabelung', audio_sr_note:'Abtastrate: 32.000 Hz (von Perch V2 vorgegeben)',
      cal_title:'Interkanalkalib.', cal_need_2ch:'Kalibrierung erfordert 2 Mikrofone.', cal_expired:'Kalibrierung abgelaufen (> 7 Tage).', cal_not_done:'Beide Kanäle nicht kalibriert.', cal_instructions:'Beide Mikrofone nebeneinander (< 5 cm), gleiche Richtung. 10 Sekunden.', cal_start:'Kalibrierung starten', cal_capturing:'Aufnahme... (10 Sekunden)', cal_apply:'Anwenden und speichern', cal_retry:'Wiederholen',
      notif_channel:'Benachrichtigungskanal', notif_on:'Benachrichtigungen aktiv', notif_off:'Benachrichtigungen deaktiviert', notif_save:'Speichern', notif_test:'Testen', notif_rare:'Seltene Art', notif_rare_desc:'Nie gesehen oder weniger als N Erkennungen', notif_season:'Erste der Saison', notif_season_desc:'Seit N Tagen nicht gesehen', notif_season_days_label:'Abwesend seit', notif_new:'Neue Art — Nie erkannt', notif_daily:'Erste des Tages', notif_daily_warn:'laut: ~50 Benachr./Tag', notif_each:'Jede Erkennung', notif_each_warn:'sehr laut: ~1000+/Tag', notif_favorites:'Favoriten', notif_favorites_desc:'Benachrichtigung bei Erkennung einer Favoritenart (1× pro Tag pro Art)', notif_report:'Wochenbericht', notif_bird_alerts:'Vogelwarnungen', notif_sys_alerts:'Systemwarnungen', unit_days:'Tage', audio_overlap:'Fensterüberlappung',
      review_suspects:'{n} verdächtig', review_total:'gesamt', review_selected:'{n} ausgewählt', review_select_all:'Alle auswählen', review_deselect:'Alle abwählen', review_confirm:'Bestätigen', review_reject:'Ablehnen', review_reject_rule:'Nach Regel ablehnen', review_confirm_q:'{n} Erkennungen bestätigen?', review_reject_q:'{n} Erkennungen ablehnen?', review_reject_rule_q:'{n} "{rule}" Erkennungen ablehnen?', review_none:'Keine verdächtigen Erkennungen.', review_showing:'angezeigt', review_show_more:'Mehr anzeigen', review_confirmed_msg:'Bestätigt', review_rejected_msg:'Abgelehnt', review_doubtful_msg:'Zweifelhaft', review_action_error:'Validierungsfehler', review_detections:'Erkennungen',
      review_purge:'Abgelehnte löschen', review_purge_title:'Abgelehnte Erkennungen löschen', review_purge_warning:'Die folgenden Erkennungen werden dauerhaft aus der Datenbank gelöscht und die Audiodateien entfernt. Diese Aktion kann nicht rückgängig gemacht werden.', review_purge_confirm:'Endgültig löschen', review_delete_done:'Löschung abgeschlossen',
      models_detections:'Erkennungen', models_species:'Arten', models_avg_conf:'Durchschn. Konf.', models_daily:'Erkennungen pro Tag und Modell', models_exclusive:'Exklusive Arten', models_overlap:'Von beiden Modellen erkannte Arten', models_ratio:'Verhältnis', models_none:'Keine exklusiven Arten',
      species_tab:'Arten ein-/ausschließen', species_desc:'Steuert welche Arten erkannt werden.', species_include_desc:'Wenn ausgefüllt, nur diese Arten.', species_exclude_desc:'Diese Arten werden ignoriert.',
      fp_preview:'Vorschau', fp_recording:'Aufnahme (3s)...', fp_title:'Vorher / Nachher Filter', fp_before:'Vorher (Rohsignal)', fp_after:'Nachher (Filter angewendet)', fp_hint:'Spektrogramm aus 3 Sekunden Mikrofon. Erneut starten zum Aktualisieren.',
      audio_1ch:'1 Mikrofon (Kanal 0)', audio_2ch:'2 Mikrofone (Kanäle 0+1)', audio_highpass:'Hochpassfilter', audio_lowpass:'Tiefpassfilter', audio_lp_birds:'Vögel', audio_lp_wide:'Breit', audio_lp_full:'Voll', audio_denoise:'Spektrale Rauschunterdrückung', audio_denoise_desc:'Reduziert konstante Hintergrundgeräusche (Wind, Verkehr, Insekten) durch spektrales Gating. Erfordert scipy + noisereduce.', audio_denoise_light:'Leicht', audio_denoise_strong:'Stark', audio_denoise_warn:'Hohe Werte können leise Vogelrufe abschwächen.', audio_rms:'RMS-Normalisierung', audio_levels:'Eingangspegel in Echtzeit', audio_test:'Audiotest (5 Sekunden)', audio_test_btn:'Audio testen', audio_duplicate:'Duplizieren', audio_delete:'Löschen', audio_calm:'Ruhig', audio_road:'Straße', audio_urban:'Städtisch', audio_cpu_warn:'Hohe CPU-Last auf RPi5', audio_threshold:'Schwelle', audio_max_det:'max Erkennungen gesamt', audio_target:'Ziel',
      audio_enabled:'Aktiviert', audio_start:'Starten', audio_stop:'Stoppen', audio_click_start:'Klicken Sie auf Starten, um die Audiopegel anzuzeigen.', audio_detected:'Erkannte Audiogeräte', audio_sub_device:'Gerät', audio_sub_profile:'Profil & Einstellungen', audio_sub_cal:'Kalibrierung', audio_sub_monitor:'Monitoring', audio_last_cal:'Letzte Kalibrierung', audio_ch0:'Kanal 0 (CH0)', audio_ch1:'Kanal 1 (CH1)', audio_gain_comp:'Ausgleichsverstärkung', audio_sum:'Summierung', audio_sum_desc:'Beide Signale kombinieren (SNR +3dB)', audio_max:'Maximum', audio_max_desc:'Höchsten Score behalten', audio_vote:'Abstimmung', audio_vote_desc:'Erkennung auf beiden Kanälen erforderlich',
      ag_title:'Adaptive Normalisierung', ag_desc:'Passt Software-Gain an Umgebungsgeräusche an. Beobachtermodus: berechnet ohne Anwendung.', ag_enabled:'Aktivieren', ag_mode:'Modus', ag_conservative:'Konservativ', ag_balanced:'Ausgewogen', ag_night:'Nacht', ag_observer:'Nur Beobachter', ag_apply:'Gain anwenden', ag_min:'Min Gain', ag_max:'Max Gain', ag_interval:'Intervall', ag_history:'Verlauf', ag_target:'Zielpegel', ag_clip_guard:'Clipping-Schutz', ag_hold:'Aktivitätssperre', ag_state:'Aktueller Zustand', ag_noise_floor:'Grundrauschen', ag_activity:'Aktivität', ag_peak:'Spitze', ag_current_gain:'Aktueller Gain', ag_recommended:'Empfohlener Gain', ag_reason:'Grund', ag_disabled:'Deaktiviert', ag_stable:'Stabil', ag_step_up:'Erhöhung', ag_step_down:'Absenkung', ag_clip:'Clipping-Schutz', ag_activity_hold:'Sperre (Aktivität)', ag_observer_mode:'Beobachtung', ag_init:'Initialisierung', ag_not_enough:'Nicht genug Daten', ag_advanced:'Erweiterte Einstellungen', ag_noise_pct:'Rausch-Perzentil',
      retention_days:'Audio-Aufbewahrung (Tage)', terminal_desc:'Bash — unterstützt Claude Code', spectro_live:'Live Mikro', spectro_clips:'Erkennungsclips',
      audio_cleaning:'Audio wird bereinigt…', audio_analyzing:'Audio wird analysiert…', audio_unavailable:'Audiodatei nicht verfügbar', audio_not_found:'Audiodatei nicht gefunden (404)', audio_decode_error:'Audio-Decodierungsfehler', audio_no_file:'Keine Audiodatei aufgenommen', audio_bad_name:'Dateiname nicht erkannt', audio_clean_progress:'Bereinigung…', audio_clean_done:'Bereinigt', audio_clean_btn:'Audio bereinigen', no_data:'Keine Daten', svc_engine:'Erkennungsmotor', svc_recording:'Audioaufnahme', svc_web:'Webserver', svc_terminal:'Webterminal', sys_tab_health:'Zustand', sys_tab_model:'Modell', sys_tab_data:'Daten', sys_tab_external:'Extern',
      shannon_index:'Shannon-Index', shannon_evenness:'Gleichmäßigkeit', personal_notes:'Persönliche Notizen',
      bio_taxonomy_orders:'Verteilung nach Ordnung', bio_taxonomy_families:'Erkannte Familien',
      rare_species:'Seltene Arten', rare_desc:'Arten mit weniger als {n} Erkennungen',
      first_seen:'Erstmals gesehen', detections_count:'Erkennungen',
      top_by_count:'Rangliste nach Erkennungen', top_by_confidence:'Rangliste nach Konfidenz',
      confidence_distrib:'Konfidenzverteilung', activity_calendar:'Aktivitätskalender',
      monthly_totals:'Monatssummen',
      freq_range:'Frequenzbereich',
      nav_weather:'Wetter & Vögel', weather_activity:'Wetter & Aktivität', weather_correlation:'Wetter/Aktivitäts-Korrelation', weather_best:'Beste Bedingungen: ~{temp}°C, ~{precip}mm Regen/Tag', weather_best_full:'Beste Bedingungen: ~{temp}°C, ~{precip}mm Regen, Wind ~{wind}km/h', weather_forecast:'Prognose morgen', weather_trend:'erwartete Aktivität {pct}%', weather_top_species:'Arten nach Wetterbedingungen', temperature:'Temperatur', precipitation:'Niederschlag', wind:'Wind',
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
      analyses_kpi_conf:'Ø Konfidenz', analyses_kpi_days:'Erkennungstage', analyses_kpi_avg_day:'Ø / Tag',
      analyses_polar_title:'Stundenaktivität · {species}',
      analyses_series_title:'Erkennungen im Zeitverlauf · {species}',
      analyses_heatmap_title:'Tages-Heatmap · {species}',
      circadian_comparison:'Zirkadianer Vergleich',
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
      grp_mode_species:'Nach Art', grp_mode_taxo:'Nach taxonomischer Gruppe',
      grp_title_order:'Ordnungsanalyse · {name}', grp_title_family:'Familienanalyse · {name}',
      grp_kpi_species:'Arten in der Gruppe', grp_kpi_detections:'Erkennungen gesamt',
      grp_kpi_conf:'Ø Konfidenz', grp_kpi_days:'Aktive Tage', grp_kpi_avg_day:'Ø / Tag',
      grp_polar_title:'Stundenaktivität · {name}',
      grp_series_title:'Erkennungen im Zeitverlauf · {name}',
      grp_series_families:'Erkennungen nach Familie · {name}',
      grp_heatmap_title:'Tages-Heatmap · {name}',
      grp_breakdown_title:'Artenverteilung',
      grp_breakdown_species:'Art', grp_breakdown_count:'Erkennungen', grp_breakdown_pct:'%',
      grp_breakdown_conf:'Konfidenz',
      grp_select_prompt:'Wählen Sie eine Ordnung oder Familie, um die Gruppe zu analysieren.',
      grp_narr_period:'Im Zeitraum {from} → {to} zählt die Gruppe <strong>{name}</strong> {species} Arten mit {total} Erkennungen.',
      grp_narr_dominant:'Die dominante Art ist <strong>{species}</strong> mit {pct}% der Erkennungen.',
      grp_narr_peak:'Der Aktivitätshöhepunkt der Gruppe liegt um {time}.',
      // Ecological guilds
      guild_filter:'Ökologische Gilde', guild_all:'Alle Gilden',
      guild_raptors:'Greifvögel', guild_waterbirds:'Wasservögel', guild_woodpeckers:'Spechte',
      guild_passerines_forest:'Waldsingvögel', guild_passerines_open:'Offenlandsingvögel',
      guild_thrushes_chats:'Drosseln & Schmätzer', guild_warblers:'Grasmücken & Laubsänger',
      guild_corvids:'Rabenvögel', guild_swifts_swallows:'Segler & Schwalben',
      guild_pigeons_doves:'Tauben', guild_other:'Andere',
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
      quick_1d:'1T', quick_7d:'7T', quick_1m:'1M', quick_3m:'3M', quick_6m:'6M', quick_30d:'30T', quick_90d:'90T', quick_1y:'1J', quick_all:'Alle',
      per_day_avg:'/ Tag (Ø)', trend:'Trend',
      best_recordings:'Beste Aufnahmen', sort_conf_desc:'Konfidenz ↓', sort_date_desc:'Datum ↓',
      sort_species_az:'Art A→Z', filter_species_ph:'Arten filtern…', clear_all:'Alles löschen',
      select_all:'Alle auswählen', deselect_all:'Alle abwählen', no_recordings:'Keine Aufnahmen gefunden.', load_more:'Mehr laden',
      remaining:'{n} übrig', clean_audio:'Audio bereinigen', cleaned:'Bereinigt', cleaning:'Bereinigung…',
      force:'Stärke', spectral_sub:'Hochpassfilter + Spektralsubtraktion',
      af_gain:'Gain (dB)', af_highpass:'Hochpass (Hz)', af_lowpass:'Tiefpass (Hz)', af_off:'Aus',
      af_file_info:'Dateiinfo', af_duration:'Dauer', af_type:'Typ', af_size:'Größe',
      af_sample_rate:'Abtastrate', af_channels:'Kanäle', af_file_path:'Pfad',
      af_mono:'Mono', af_stereo:'Stereo', af_filters:'Audiofilter',
      mod_title:'Modell-Monitoring', mod_current:'Aktives Modell', mod_detections:'Erkennungen',
      mod_species:'Arten', mod_confidence:'Ø Konfidenz', mod_rate:'Rate',
      mod_per_hour:'/h', mod_conf_dist:'Konfidenzverteilung',
      mod_top_species:'Top-Arten', mod_trend:'7-Tage-Trend', mod_no_data:'Keine Daten',
      mod_today:'Heute', mod_7d:'7T', mod_30d:'30T',
      cmp_title:'Periodenvergleich', cmp_split_date:'Stichtag',
      cmp_before:'Vorher', cmp_after:'Nachher', cmp_det_day:'Erk./Tag',
      cmp_species_gained:'Neue Arten', cmp_species_lost:'Verlorene Arten',
      cmp_nocturnal:'Nächtliche Erkennungen', cmp_nocturnal_sub:'22h – 4h',
      cmp_none:'Keine', cmp_per_day:'/T', cmp_change:'Änderung',
      cmp_species_detail:'Vergleich nach Art', cmp_count:'Anz.',
      del_manage:'Erkennungen verwalten', del_this:'Diese Erkennung löschen',
      del_all:'Alle löschen', del_confirm_title:'Unwiderrufliche Löschung',
      del_confirm_body:'Dies löscht {count} Erkennungen und alle Audiodateien für „{name}". Diese Aktion kann nicht rückgängig gemacht werden.',
      del_type_name:'Geben Sie „{name}" zur Bestätigung ein:',
      del_permanently:'Endgültig löschen', cancel:'Abbrechen',
      del_one_confirm:'Erkennung vom {date} um {time} löschen (Konfidenz: {conf})?\n\nDie Audiodatei wird ebenfalls gelöscht.',
      del_success:'Erkennungen gelöscht', del_file_errors:'Dateien konnten nicht gelöscht werden',
      del_done_title:'Löschung abgeschlossen', del_records_removed:'Erkennungen entfernt',
      del_files_removed:'Dateien entfernt', del_close:'Schließen',
      avg_conf_short:'Ø Konfidenz', days_detected:'Erkennungstage',
      activity_30d:'Aktivität — 30 Tage', conf_distribution:'Konfidenzverteilung',
      activity_month_hour:'Saisonale Aktivität nach Stunde', description:'Beschreibung', description_en:'Beschreibung (Englisch)',
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
      all_rarities:'Alle Seltenheiten', updated_at:'Aktualisiert', ebird_notable_title:'eBird — Bemerkenswerte Beobachtungen', bw_period_today:'Heute', bw_period_week:'7T', bw_period_month:'30T', bw_period_all:'Alle', unit_d:'T', unit_h:'h', unit_m:'m',
      no_notable_obs:'Keine bemerkenswerten Beobachtungen in den letzten 7 Tagen.',
      quick_today:'Heute',
      sys_tab_health:'Zustand', sys_tab_model:'Modell', sys_tab_data:'Daten', sys_tab_external:'Extern',
      sys_health_title:'Systemzustand', sys_cpu:'CPU', sys_ram:'RAM', sys_disk:'Festplatte',
      sys_temp:'Temperatur', sys_fan:'Lüfter', sys_uptime_label:'Betriebszeit', sys_load:'Last',
      sys_cores:'Kerne',
      sys_services_title:'Dienste', sys_svc_logs:'Protokolle', sys_svc_no_logs:'Keine Protokolle',
      sys_confirm_stop:'Stopp bestätigen', sys_confirm_stop_msg:'Dienst „{name}" stoppen? Dies kann die Analyse unterbrechen.',
      sys_cancel:'Abbrechen', sys_svc_starting:'Startet…', sys_svc_stopping:'Stoppt…',
      sys_analysis_title:'Analysestatus', sys_backlog:'Rückstand', sys_lag:'Verzögerung',
      sys_inference:'Inferenz', sys_model_active:'Aktives Modell',
      sys_files_pending:'Dateien ausstehend', sys_seconds:'Sekunden', sys_minutes:'Min',
      sys_audio_title:'Audio', sys_rec_card:'Eingabekarte', sys_channels_label:'Kanäle', sys_format:'Format',
      sys_backup_title:'Sicherung', sys_backup_dest:'Ziel', sys_backup_mount:'Mount', sys_last_backup:'Letzte Sicherung',
      sys_backup_size:'Größe', sys_mounted:'Eingebunden', sys_not_mounted:'Nicht eingebunden', sys_not_configured:'Nicht konfiguriert',
      set_backup:'Sicherung', set_backup_dest:'Ziel', set_backup_content:'Zu sichernder Inhalt',
      set_backup_dest_local:'USB-Disk / Lokal', set_backup_dest_smb:'SMB/CIFS-Freigabe', set_backup_dest_nfs:'NFS-Mount',
      set_backup_dest_sftp:'SFTP', set_backup_dest_s3:'Amazon S3', set_backup_dest_gdrive:'Google Drive',
      set_backup_dest_webdav:'WebDAV', set_backup_content_db:'Datenbank', set_backup_content_audio:'Audiodateien',
      set_backup_content_config:'Konfiguration', set_backup_content_all:'Alles sichern',
      set_backup_path:'Pfad / Mountpunkt', set_backup_host:'Server', set_backup_port:'Port',
      set_backup_user:'Benutzername', set_backup_pass:'Passwort', set_backup_share:'Freigabe',
      set_backup_bucket:'Bucket', set_backup_region:'Region', set_backup_access_key:'Zugriffsschlüssel',
      set_backup_secret_key:'Geheimschlüssel', set_backup_remote_path:'Entfernter Pfad',
      set_backup_schedule:'Zeitplan', set_backup_schedule_manual:'Nur manuell',
      set_backup_schedule_daily:'Täglich', set_backup_schedule_weekly:'Wöchentlich',
      set_backup_schedule_time:'Sicherungszeit', set_backup_retention:'Aufbewahrung (Tage)',
      set_backup_run_now:'Jetzt ausführen', set_backup_running:'Sicherung läuft…',
      set_backup_save:'Sicherungskonfiguration speichern',
      set_backup_saved:'Sicherungskonfiguration gespeichert',
      set_backup_last_status:'Letzter Status', set_backup_never:'Noch nie ausgeführt',
      set_backup_success:'Erfolgreich', set_backup_failed:'Fehlgeschlagen',
      set_backup_gdrive_folder:'Google Drive Ordner-ID',
      set_backup_state_running:'Läuft', set_backup_state_completed:'Abgeschlossen',
      set_backup_state_failed:'Fehlgeschlagen', set_backup_state_stopped:'Gestoppt',
      set_backup_state_paused:'Pausiert',
      set_backup_step:'Schritt', set_backup_started:'Gestartet vor',
      set_backup_pause:'Pause', set_backup_resume:'Fortsetzen', set_backup_stop:'Stopp',
      set_backup_stop_confirm:'Laufendes Backup stoppen? (rsync setzt beim nächsten Lauf fort)',
      set_backup_transferred:'Übertragen', set_backup_disk_free:'Freier Speicher',
      sys_network_title:'Netzwerk', sys_hostname:'Hostname', sys_ip:'IP-Adresse',
      sys_gateway:'Gateway', sys_internet:'Internet',
      sys_nas_ping:'NAS-Ping', sys_reachable:'Erreichbar', sys_unreachable:'Nicht erreichbar',
      sys_hardware_title:'Hardware',
      nav_prev_day:'Vorheriger Tag', nav_next_day:'Nächster Tag',
      select_species_prompt:'Art auswählen', listen_spectro_hint:'zum Anhören und Spektrogramm anzeigen',
      next_det_audio:'Nächste Erkennung mit Audio →',
      download:'Herunterladen', download_audio:'Audio herunterladen',
      ebird_export:'eBird-Export',
      click_to_edit_value:'Klicken, um Wert einzugeben',
      search_filter_ph:'filtern…', search_species_ph:'Suchen… (Taste /)',
      fft_analysis:'FFT-Analyse…',
      ebird_api_missing:'API-Schlüssel fehlt',
      ebird_enable_text:'Um diesen Bereich zu aktivieren, holen Sie sich einen kostenlosen Schlüssel auf',
      ebird_then_configure:'und konfigurieren Sie ihn auf dem Pi:',
      ebird_add_env:'Hinzufügen:', ebird_your_key:'ihr_schlüssel',
      ebird_no_notable:'Keine bemerkenswerten Beobachtungen in den letzten 7 Tagen.',
      ebird_see_on:'Auf eBird ansehen', bw_see_on:'Auf BirdWeather ansehen',
      bw_add_in:'Hinzufügen in', bw_id_in_url:'Die ID ist in der URL sichtbar:',
      top_detected:'Top erkannte Arten',
      detected_locally:'Auch lokal erkannt', not_detected_locally:'Nicht lokal erkannt',
      no_rarities_detected:'Keine Seltenheiten kürzlich erkannt',
      search_placeholder:'Art suchen\u2026',
      // Lifers
      lifers_label:'Erstbeobachtungen', no_lifers:'Keine Erstbeobachtungen für dieses Datum',
      // Morning summary (legacy)
      morning_summary:'Was gibt\'s Neues', new_today:'Neu heute', best_detection:'Beste Erkennung',
      vs_yesterday:'vs gestern', no_new_species:'Keine neuen Arten',
      // What's New module
      wn_title:'Was gibt\'s Neues',
      wn_level_alerts:'Warnungen', wn_level_phenology:'Phänologie', wn_level_context:'Kontext des Tages',
      wn_card_out_of_season:'Art außerhalb der Saison', wn_card_activity_spike:'Aktivitätspeak',
      wn_card_species_return:'Rückkehr einer Art', wn_card_first_of_year:'Erste des Jahres',
      wn_card_species_streak:'Ununterbrochene Präsenz', wn_card_seasonal_peak:'Saisonaler Höhepunkt',
      wn_card_dawn_chorus:'Morgenchor', wn_card_acoustic_quality:'Akustische Qualität',
      wn_card_species_richness:'Artenreichtum', wn_card_moon_phase:'Mondphase',
      wn_insuf_label:'Unzureichende Daten',
      wn_insuf_needsWeek:'Diese Karte benötigt mindestens 7 Tage Erkennungsdaten.',
      wn_insuf_needsTwoWeeks:'Diese Karte benötigt mindestens 15 Tage Erkennungsdaten.',
      wn_insuf_needsMonth:'Diese Karte benötigt mindestens 28 Tage Daten für eine zuverlässige Basislinie.',
      wn_insuf_needsSeason:'Diese Karte benötigt mindestens ein Jahr Daten.',
      wn_insuf_needsGPS:'GPS-Koordinaten nicht konfiguriert. Setzen Sie LATITUDE und LONGITUDE in /etc/birdnet/birdnet.conf.',
      wn_insuf_tooEarly:'Noch nicht genug Erkennungen heute. Schauen Sie später wieder rein.',
      wn_moon_new_moon:'Neumond', wn_moon_waxing_crescent:'Zunehmende Sichel',
      wn_moon_first_quarter:'Erstes Viertel', wn_moon_waxing_gibbous:'Zunehmender Mond',
      wn_moon_full_moon:'Vollmond', wn_moon_waning_gibbous:'Abnehmender Mond',
      wn_moon_last_quarter:'Letztes Viertel', wn_moon_waning_crescent:'Abnehmende Sichel',
      wn_migration_favorable:'Günstige Migration', wn_migration_moderate:'Mäßige Migration', wn_migration_limited:'Eingeschränkte Migration',
      wn_quality_good:'Gut', wn_quality_moderate:'Mäßig', wn_quality_poor:'Schlecht',
      wn_trend_above:'Über Durchschnitt', wn_trend_normal:'Normal', wn_trend_below:'Unter Durchschnitt',
      wn_spike_ratio:'× Durchschnitt', wn_streak_days:'aufeinanderfolgende Tage', wn_absent_days:'Tage abwesend',
      wn_species_detected:'Arten erkannt', wn_detections:'Erkennungen', wn_vs_avg:'vs Durchschn.',
      wn_illumination:'Beleuchtung', wn_acceptance_rate:'Akzeptanzrate', wn_strong_detections:'Starke Erkennungen',
      // Phenology & quick play
      phenology:'Phänologie', first_arrival:'Erste Ankunft', last_departure:'Letzter Abflug', quick_play:'Schnellwiedergabe',
      // Validation
      validation_confirmed:'Bestätigt', validation_doubtful:'Zweifelhaft', validation_rejected:'Abgelehnt', validation_unreviewed:'Ungeprüft',
      hide_rejected:'Abgelehnte ausblenden', validation_stats:'Validierungsstatistiken',
      // Timeline
      tl_title:'Tagesjournal', tl_notable:'bemerkenswerte Ereignisse', tl_full_view:'Vollansicht',
      tl_see_full:'Vollständige Zeitleiste anzeigen', tl_loading:'Laden…',
      tl_prev_day:'Vorheriger Tag', tl_next_day:'Nächster Tag',
      tl_species:'Arten', tl_detections:'Erkennungen', tl_chronology:'Chronologie der Ereignisse',
      tl_see_species:'Artkarte anzeigen', tl_see_today:'Tag anzeigen', tl_listen:'Anhören', tl_validate:'Bestätigen',
      tl_density_label:'Erkennungsintensität', tl_density_label_short:'Vögel', tl_now:'jetzt', tl_drag_hint:'ziehen zum Zoomen',
      tl_type_nocturnal:'🌙 Nachtaktiv', tl_type_rare:'⭐ Selten', tl_type_firstyear:'🌱 Erstnachweis',
      tl_type_firstday:'🐦 Erste tagsüber', tl_type_best:'🎵 Beste Erkennung', tl_type_out_of_season:'⚠️ Außer Saison', tl_type_species_return:'🔄 Rückkehr', tl_type_top_species:'🐦 Arten',
      tl_density_0:'Sehr wenig', tl_density_1:'Wenig', tl_density_2:'Normal', tl_density_3:'Mehr', tl_density_4:'Maximum', tl_density_5:'Alle',
      tl_tag_nocturnal:'Nachtaktiv', tl_tag_strict_nocturnal:'Streng nachtaktiv',
      tl_tag_migration:'Migration', tl_tag_out_of_season:'Außer Saison',
      tl_tag_rare:'Selten', tl_tag_firstyear:'Erstnachweis', tl_tag_firstday:'Erste tagsüber', tl_tag_best:'Beste Konfidenz',
      tl_tag_species_return:'Rückkehr', tl_tag_activity_spike:'Aktivitätsspitze', tl_tag_top_species:'Tagesstar',
      tl_sunrise:'Aufgang', tl_sunset:'Untergang', tl_confidence:'Konfidenz',
    },

    nl: {
      _meta: { lang:'nl', label:'Nederlands', flag:'🇳🇱' },
      nav_sec_realtime:'Live', nav_sec_history:'Geschiedenis', nav_sec_species:'Soorten', nav_sec_insights:'Inzichten', nav_sec_system:'Station',
      nav_sec_observe:'Observeren', nav_sec_explore:'Verkennen',
      nav_overview:'Startpagina', nav_today:'Vandaag', nav_recent:'Activiteit', nav_review:'Te controleren',
      nav_detections:'Detecties', nav_species:'Soorten',
      nav_biodiversity:'Biodiversiteit', nav_rarities:'Zeldzaamheden',
      nav_stats:'Statistieken', nav_system:'Monitoring', nav_analyses:'Analyse', nav_models:'Modellen', nav_terminal:'Terminal', nav_spectrogram:'Live', nav_recordings:'Opnames', nav_gallery:'Beste opnames', nav_settings:'Configuratie', nav_timeline:'Kalender', nav_calendar:'Kalender', nav_log:'Live log',
      log_live:'Live', log_paused:'Gepauzeerd', log_disconnected:'Verbroken', log_pause:'Pauzeren', log_resume:'Hervatten', log_clear:'Wissen', log_errors:'Fouten', log_lines:'Regels', log_all:'Alle', log_waiting:'Wachten op logs...',
      gallery_title:'Beste opnames', gallery_tab_best:'Beste', gallery_tab_library:'Audiobibliotheek', gallery_delete:'Verwijderen', gallery_delete_confirm:'Deze detectie en bijbehorende bestanden verwijderen?', top_detections_per_species:'beste detecties',
      set_location:'Locatie', set_site_name:'Sitenaam', set_site_brand:'Merknaam (header)', set_latitude:'Breedtegraad', set_longitude:'Lengtegraad',
      set_model:'Detectiemodel', set_model_choice:'AI-model', set_species_freq_thresh:'Soortfrequentiedrempel',
      set_analysis:'Analyse', set_params:'Parameters', set_shared_params:'Gedeelde parameters', set_confidence:'Betrouwbaarheid', set_birdnet_conf:'BirdNET-betrouwbaarheid', set_perch_conf:'Perch-betrouwbaarheid', set_perch_margin:'Perch-marge (top1-top2)', set_sensitivity:'Gevoeligheid',
      set_language:'Soorttaal', set_notifications:'Meldingen',
      set_notify_each:'Elke detectie melden', set_notify_new_species:'Nieuwe soort melden',
      set_notify_new_daily:'Eerste soort van de dag melden', set_weekly_report:'Weekrapport',
      set_notif_urls:'Notificatie-URLs (Apprise)', set_notif_urls_help:'Eén URL per regel. Voorbeelden:',
      set_notif_title:'Notificatietitel', set_notif_body:'Berichttekst',
      set_notif_body_help:'Variabelen: $comname, $sciname, $confidence, $date, $time',
      set_notif_test:'Testen', set_notif_testing:'Verzenden…', set_notif_test_ok:'Notificatie verzonden!',
      set_notif_test_fail:'Mislukt: {error}', set_notif_cooldown:'Min. vertraging tussen notificaties (sec.)',
      set_notif_no_urls:'Geen URLs geconfigureerd — notificaties worden niet verzonden.',
      set_alerts_title:'Systeemalarmen', set_alerts_desc:'Ontvang een melding bij overschrijding van kritische drempels.',
      set_notif_events_title:'Notificatie-evenementen', set_notif_events_desc:'Vink de evenementen aan waarvoor u meldingen wilt ontvangen.',
      set_notif_cat_birds:'Soortdetecties', set_notif_cat_system:'Systeembewaking',
      set_alert_temp_warn:'Temperatuur waarschuwing', set_alert_temp_crit:'Temperatuur kritiek',
      set_alert_disk_warn:'Schijfruimte waarschuwing', set_alert_ram_warn:'RAM waarschuwing',
      set_alert_backlog:'Analyse-achterstand', set_alert_no_det:'Detectiestilte',
      set_alert_svc_down:'Alarm bij uitval van een kritieke dienst',
      set_notif_cat_bird_smart:'Slimme vogelalarmen',
      set_alert_influx:'Ongebruikelijke toestroom (>3x gemiddelde)', set_alert_missing:'Veelvoorkomende soort afwezig (na de middag)', set_alert_rare_visitor:'Zeldzame bezoeker gedetecteerd',
      set_tab_detection:'Detectie', set_tab_audio:'Audio', set_tab_notif:'Meldingen', set_tab_station:'Station', set_tab_services:'Diensten', set_tab_species:'Soorten', set_tab_system:'Systeem', set_tab_backup:'Back-up', set_tab_database:'Database', set_tab_terminal:'Terminal',
      bkp_init:'Initialisatie', bkp_db:'Database', bkp_config:'Configuratie', bkp_projects:'Projecten', bkp_audio:'BirdSongs', bkp_upload:'Upload', bkp_mount:'Koppeling', bkp_done:'Klaar', bkp_stopped_by_user:'Gestopt door gebruiker', bkp_starting:'Starten…', bkp_next_run:'Volgende', bkp_no_schedule:'Geen planning — handmatige modus', bkp_history:'Geschiedenis',
      share:'Delen', analyze_deep:'Diepgaande analyse', fav_add:'Toevoegen aan favorieten', fav_remove:'Verwijderen uit favorieten', nav_favorites:'Favorieten', fav_total:'Totaal favorieten', fav_active_today:'Vandaag actief', fav_total_dets:'Totaal detecties', fav_today_dets:'Detecties vandaag', fav_added:'Toegevoegd op', fav_last_seen:'Laatst gezien', fav_first_seen:'Eerste detectie', fav_avg_conf:'Gem. betrouwbaarheid', fav_empty:'Geen favorieten — voeg soorten toe met ☆', fav_sort_name:'Naam', fav_sort_recent:'Recent', fav_sort_count:'Detecties', photo_ban:'Blokkeren', photo_set_preferred:'Als standaard', photo_banned:'Foto geblokkeerd', photo_reset:'Resetten', fav_only:'Alleen favorieten', phenology_calendar:'Fenologiekalender', notifications:'Meldingen', wn_empty:'Niets nieuws',
      set_save:'Opslaan', set_saved:'Configuratie succesvol opgeslagen', set_defaults:'Standaard', set_defaults_confirm:'Alle detectieparameters terugzetten naar standaardwaarden?', set_defaults_applied:'Standaardwaarden toegepast — klik Opslaan om te bevestigen',
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
      set_model_desc_perch:'Google Perch V2 — 10.340 vogels onder 15K totale soorten',
      set_model_desc_perch_fp16:'Google — 10.340 vogels, ~384 ms op Pi 5. Vrijwel perfecte kwaliteit (top-1 100%, top-5 99%).',
      set_model_desc_perch_dynint8:'Google — 10.340 vogels, ~299 ms op Pi 5, ~700 ms op Pi 4. 4× lichter (top-1 93%).',
      set_model_desc_perch_original:'Google — 10.340 vogels, ongewijzigde referentie. Meest nauwkeurig maar zwaarst (~435 ms op Pi 5).',
      set_model_desc_go:'BirdNET-Go — experimentele variant',
      set_restart_confirm:'Services herstarten om toe te passen?', set_save_restart:'Opslaan & herstarten',
      today:'Vandaag', this_week:'Deze week', this_month:'Deze maand', all_time:'Totaal',
      detections:'Detecties', species:'Soorten', avg_confidence:'Gem. betrouwbaarheid',
      last_detection:'Laatste detectie', top_species:'Top soorten',
      activity_7d:'7-daagse activiteit', activity_today:'Activiteit vandaag',
      last_hour:'Laatste uur', new_species:'Nieuwe soorten', rare_today:'Zeldzame soorten vandaag',
      recent_detections:'Recente detecties', today_log:'Dagboek',
      no_data:'Geen gegevens', loading:'Laden…', error:'Fout', network_error:'Netwerkfout',
      date:'Datum', time:'Tijd', species_name:'Soort', scientific_name:'Wetenschappelijke naam',
      confidence:'Betrouwbaarheid', audio:'Audio', play:'Afspelen',
      filter_species:'Filter op soort', filter_order:'Taxonomische orde', filter_family:'Familie',
      all_orders:'Alle ordes', all_families:'Alle families',
      filter_date_from:'Van', filter_date_to:'Tot',
      filter_confidence:'Min. betrouwbaarheid', all_species:'Alle soorten',
      apply_filter:'Toepassen', reset_filter:'Resetten', default_btn:'Standaard',
      prev_page:'← Vorige', next_page:'Volgende →', page:'Pagina', of:'van', results:'resultaten',
      species_detail:'Soortinfo', first_detection:'Eerste detectie', last_seen:'Laatst gezien',
      total_detections:'Totaal detecties', max_confidence:'Max. betrouwbaarheid',
      activity_by_hour:'Activiteit per uur', monthly_presence:'Maandelijkse aanwezigheid',
      external_links:'Externe links', listen_on:'Beluisteren op', observe_on:'Observeren op',
      species_x_month:'Soorten per maand', richness_per_day:'Dagelijkse rijkdom',
      heatmap_hour_day:'Activiteit uur × dag',
      kb_shortcuts_hint:'Spatie = afspelen, ← → = navigatie',
      db_tables:'Tabellen', db_refresh:'Vernieuwen', db_schema:'Schema', db_query:'SQL-query', db_exec:'Uitvoeren', db_executing:'Bezig...', db_readonly:'Alleen lezen — SELECT, PRAGMA, WITH', db_rows:'{n} rij(en)', db_col:'Kolom', db_type:'Type', db_new:'Nieuw',
      dual_model:'Dual-model', dual_desc:'Elk bestand met twee modellen parallel analyseren', secondary_model:'Secundair model', dual_active:'{model} actief', dual_wait:'Secundair model laadt bij volgende cyclus (~5 min).', dual_status_active:'actief', dual_status_primary:'Primair', dual_status_secondary:'Secundair',
      audio_profile:'Actief profiel', audio_strategy:'Meerkanaals strategie', audio_strategy_2ch:'Alleen beschikbaar met 2 microfoons.', audio_save:'Opslaan', audio_refresh:'Vernieuwen', audio_no_device:'Geen audioapparaat gevonden.', audio_wiring:'Microfoon bedrading', audio_sr_note:'Samplerate: 32.000 Hz (vereist door Perch V2)',
      cal_title:'Interkanaalkalibratie', cal_need_2ch:'Kalibratie vereist 2 microfoons.', cal_expired:'Kalibratie verlopen (> 7 dagen).', cal_not_done:'Beide kanalen niet gekalibreerd.', cal_instructions:'Plaats beide microfoons naast elkaar (< 5 cm). 10 seconden.', cal_start:'Kalibratie starten', cal_capturing:'Opname... (10 seconden)', cal_apply:'Toepassen en opslaan', cal_retry:'Opnieuw',
      notif_channel:'Meldingskanaal', notif_on:'Meldingen actief', notif_off:'Meldingen uitgeschakeld', notif_save:'Opslaan', notif_test:'Testen', notif_rare:'Zeldzame soort', notif_rare_desc:'Nooit gezien of minder dan N detecties', notif_season:'Eerste van het seizoen', notif_season_desc:'Niet gezien sinds N dagen', notif_season_days_label:'Afwezig sinds', notif_new:'Nieuwe soort — Nooit gedetecteerd', notif_daily:'Eerste van de dag', notif_daily_warn:'druk: ~50 meld./dag', notif_each:'Elke detectie', notif_each_warn:'zeer druk: ~1000+/dag', notif_favorites:'Favorieten', notif_favorites_desc:'Melding bij detectie van een favoriet (1× per dag per soort)', notif_report:'Weekrapport', notif_bird_alerts:'Vogelwaarschuwingen', notif_sys_alerts:'Systeemwaarschuwingen', unit_days:'dagen', audio_overlap:'Vensteroverlapping',
      review_suspects:'{n} verdacht', review_total:'totaal', review_selected:'{n} geselecteerd', review_select_all:'Alles selecteren', review_deselect:'Alles deselecteren', review_confirm:'Bevestigen', review_reject:'Afwijzen', review_reject_rule:'Afwijzen per regel', review_confirm_q:'{n} detecties bevestigen?', review_reject_q:'{n} detecties afwijzen?', review_reject_rule_q:'{n} "{rule}" detecties afwijzen?', review_none:'Geen verdachte detecties.', review_showing:'weergegeven', review_show_more:'Meer tonen', review_confirmed_msg:'Bevestigd', review_rejected_msg:'Afgewezen', review_doubtful_msg:'Twijfelachtig', review_action_error:'Validatiefout', review_detections:'detecties',
      review_purge:'Afgewezen verwijderen', review_purge_title:'Afgewezen detecties verwijderen', review_purge_warning:'De volgende detecties worden permanent uit de database verwijderd en de audiobestanden worden gewist. Deze actie kan niet ongedaan worden gemaakt.', review_purge_confirm:'Definitief verwijderen', review_delete_done:'Verwijdering voltooid',
      models_detections:'detecties', models_species:'soorten', models_avg_conf:'gem. conf.', models_daily:'Detecties per dag en model', models_exclusive:'Exclusieve soorten', models_overlap:'Door beide modellen gedetecteerde soorten', models_ratio:'Verhouding', models_none:'Geen exclusieve soorten',
      species_tab:'Soorten in-/uitsluiten', species_desc:'Bepaal welke soorten worden gedetecteerd.', species_include_desc:'Indien ingevuld, alleen deze soorten.', species_exclude_desc:'Deze soorten worden genegeerd.',
      fp_preview:'Voorbeeld', fp_recording:'Opname (3s)...', fp_title:'Voor / Na filters', fp_before:'Voor (rauw signaal)', fp_after:'Na (filters toegepast)', fp_hint:'Spectrogram van 3 seconden microfoon. Opnieuw starten om te vernieuwen.',
      audio_1ch:'1 microfoon (kanaal 0)', audio_2ch:'2 microfoons (kanalen 0+1)', audio_highpass:'Hoogdoorlaatfilter', audio_lowpass:'Laagdoorlaatfilter', audio_lp_birds:'Vogels', audio_lp_wide:'Breed', audio_lp_full:'Vol', audio_denoise:'Spectrale ruisonderdrukking', audio_denoise_desc:'Vermindert constant achtergrondgeluid (wind, verkeer, insecten) via spectrale gating. Vereist scipy + noisereduce.', audio_denoise_light:'Licht', audio_denoise_strong:'Sterk', audio_denoise_warn:'Hoge waarden kunnen zachte vogelzang verzwakken.', audio_rms:'RMS-normalisatie', audio_levels:'Ingangsniveaus real-time', audio_test:'Audiotest (5 seconden)', audio_test_btn:'Audio testen', audio_duplicate:'Dupliceren', audio_delete:'Verwijderen', audio_calm:'Rustig', audio_road:'Weg', audio_urban:'Stedelijk', audio_cpu_warn:'Hoge CPU-belasting op RPi5', audio_threshold:'Drempel', audio_max_det:'max detecties totaal', audio_target:'Doel',
      audio_enabled:'Ingeschakeld', audio_start:'Starten', audio_stop:'Stoppen', audio_click_start:'Klik op Starten om audioniveaus weer te geven.', audio_detected:'Gedetecteerde audioapparaten', audio_sub_device:'Apparaat', audio_sub_profile:'Profiel & Instellingen', audio_sub_cal:'Kalibratie', audio_sub_monitor:'Monitoring', audio_last_cal:'Laatste kalibratie', audio_ch0:'Kanaal 0 (CH0)', audio_ch1:'Kanaal 1 (CH1)', audio_gain_comp:'Compensatieversterking', audio_sum:'Optelling', audio_sum_desc:'Beide signalen combineren (SNR +3dB)', audio_max:'Maximum', audio_max_desc:'Hoogste score behouden', audio_vote:'Stemming', audio_vote_desc:'Detectie op beide kanalen vereist',
      ag_title:'Adaptieve normalisatie', ag_desc:'Past softwaregain aan op omgevingsgeluid. Observatiemodus: berekent zonder toepassing.', ag_enabled:'Inschakelen', ag_mode:'Modus', ag_conservative:'Conservatief', ag_balanced:'Gebalanceerd', ag_night:'Nacht', ag_observer:'Alleen observeren', ag_apply:'Gain toepassen', ag_min:'Min gain', ag_max:'Max gain', ag_interval:'Interval', ag_history:'Geschiedenis', ag_target:'Doelniveau', ag_clip_guard:'Clippingbescherming', ag_hold:'Activiteitsvergrendeling', ag_state:'Huidige status', ag_noise_floor:'Ruisvloer', ag_activity:'Activiteit', ag_peak:'Piek', ag_current_gain:'Huidige gain', ag_recommended:'Aanbevolen gain', ag_reason:'Reden', ag_disabled:'Uitgeschakeld', ag_stable:'Stabiel', ag_step_up:'Verhoging', ag_step_down:'Verlaging', ag_clip:'Clippingbescherming', ag_activity_hold:'Vergrendeling (activiteit)', ag_observer_mode:'Observatie', ag_init:'Initialisatie', ag_not_enough:'Onvoldoende data', ag_advanced:'Geavanceerde instellingen', ag_noise_pct:'Ruispercentiel',
      retention_days:'Audio bewaring (dagen)', terminal_desc:'Bash — ondersteunt Claude Code', spectro_live:'Live Microfoon', spectro_clips:'Detectieclips',
      audio_cleaning:'Audio opschonen…', audio_analyzing:'Audio analyseren…', audio_unavailable:'Audiobestand niet beschikbaar', audio_not_found:'Audiobestand niet gevonden (404)', audio_decode_error:'Audio-decoderingsfout', audio_no_file:'Geen audiobestand opgenomen', audio_bad_name:'Bestandsnaam niet herkend', audio_clean_progress:'Opschonen…', audio_clean_done:'Opgeschoond', audio_clean_btn:'Audio opschonen', no_data:'Geen gegevens', svc_engine:'Detectiemotor', svc_recording:'Audio-opname', svc_web:'Webserver', svc_terminal:'Webterminal', sys_tab_health:'Status', sys_tab_model:'Model', sys_tab_data:'Gegevens', sys_tab_external:'Extern',
      shannon_index:'Shannon-index', shannon_evenness:'Gelijkmatigheid', personal_notes:'Persoonlijke notities',
      bio_taxonomy_orders:'Verdeling per orde', bio_taxonomy_families:'Gedetecteerde families',
      rare_species:'Zeldzame soorten', rare_desc:'Soorten met minder dan {n} detecties',
      first_seen:'Eerst gezien', detections_count:'Detecties',
      top_by_count:'Ranglijst op detecties', top_by_confidence:'Ranglijst op betrouwbaarheid',
      confidence_distrib:'Betrouwbaarheidsverdeling', activity_calendar:'Activiteitskalender',
      monthly_totals:'Maandtotalen',
      freq_range:'Frequentiebereik',
      nav_weather:'Weer & Vogels', weather_activity:'Weer & Activiteit', weather_correlation:'Weer/activiteit correlatie', weather_best:'Beste omstandigheden: ~{temp}°C, ~{precip}mm regen/dag', weather_best_full:'Beste omstandigheden: ~{temp}°C, ~{precip}mm regen, wind ~{wind}km/u', weather_forecast:'Prognose morgen', weather_trend:'verwachte activiteit {pct}%', weather_top_species:'Soorten per weersomstandigheden', temperature:'Temperatuur', precipitation:'Neerslag', wind:'Wind',
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
      circadian_comparison:'Circadiane vergelijking',
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
      grp_mode_species:'Per soort', grp_mode_taxo:'Per taxonomische groep',
      grp_title_order:'Orde-analyse · {name}', grp_title_family:'Familie-analyse · {name}',
      grp_kpi_species:'Soorten in de groep', grp_kpi_detections:'Totaal detecties',
      grp_kpi_conf:'Gem. betrouwbaarheid', grp_kpi_days:'Actieve dagen', grp_kpi_avg_day:'Gem. / dag',
      grp_polar_title:'Uuractiviteit · {name}',
      grp_series_title:'Detecties in de tijd · {name}',
      grp_series_families:'Detecties per familie · {name}',
      grp_heatmap_title:'Dagelijkse heatmap · {name}',
      grp_breakdown_title:'Soortverdeling',
      grp_breakdown_species:'Soort', grp_breakdown_count:'Detecties', grp_breakdown_pct:'%',
      grp_breakdown_conf:'Betrouwbaarheid',
      grp_select_prompt:'Selecteer een orde of familie om de groep te analyseren.',
      grp_narr_period:'In de periode {from} → {to} telt de groep <strong>{name}</strong> {species} soorten met {total} detecties.',
      grp_narr_dominant:'De dominante soort is <strong>{species}</strong> met {pct}% van de detecties.',
      grp_narr_peak:'De piekactiviteit van de groep is om {time}.',
      // Ecological guilds
      guild_filter:'Ecologische gilde', guild_all:'Alle gilden',
      guild_raptors:'Roofvogels', guild_waterbirds:'Watervogels', guild_woodpeckers:'Spechten',
      guild_passerines_forest:'Boszangvogels', guild_passerines_open:'Openlandvogels',
      guild_thrushes_chats:'Lijsters & vliegenvangers', guild_warblers:'Zangers',
      guild_corvids:'Kraaiachtigen', guild_swifts_swallows:'Gierzwaluwen & zwaluwen',
      guild_pigeons_doves:'Duiven', guild_other:'Overig',
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
      quick_1d:'1d', quick_7d:'7d', quick_1m:'1m', quick_3m:'3m', quick_6m:'6m', quick_30d:'30d', quick_90d:'90d', quick_1y:'1jr', quick_all:'Alles',
      per_day_avg:'/ dag (gem.)', trend:'Trend',
      best_recordings:'Beste opnames', sort_conf_desc:'Betrouwbaarheid ↓', sort_date_desc:'Datum ↓',
      sort_species_az:'Soort A→Z', filter_species_ph:'Soorten filteren…', clear_all:'Alles wissen',
      select_all:'Alles selecteren', deselect_all:'Alles deselecteren', no_recordings:'Geen opnames gevonden.', load_more:'Meer laden',
      remaining:'{n} resterend', clean_audio:'Audio opschonen', cleaned:'Opgeschoond', cleaning:'Opschonen…',
      force:'Sterkte', spectral_sub:'hoogdoorlaatfilter + spectrale subtractie',
      af_gain:'Gain (dB)', af_highpass:'Hoogdoorlaat (Hz)', af_lowpass:'Laagdoorlaat (Hz)', af_off:'Uit',
      af_file_info:'Bestandsinfo', af_duration:'Duur', af_type:'Type', af_size:'Grootte',
      af_sample_rate:'Samplefrequentie', af_channels:'Kanalen', af_file_path:'Pad',
      af_mono:'Mono', af_stereo:'Stereo', af_filters:'Audiofilters',
      mod_title:'Model monitoring', mod_current:'Actief model', mod_detections:'Detecties',
      mod_species:'Soorten', mod_confidence:'Gem. betrouwbaarheid', mod_rate:'Tempo',
      mod_per_hour:'/u', mod_conf_dist:'Betrouwbaarheidsverdeling',
      mod_top_species:'Topsoorten', mod_trend:'7d trend', mod_no_data:'Geen gegevens',
      mod_today:'Vandaag', mod_7d:'7d', mod_30d:'30d',
      cmp_title:'Periodevergelijking', cmp_split_date:'Splitdatum',
      cmp_before:'Voor', cmp_after:'Na', cmp_det_day:'Det./dag',
      cmp_species_gained:'Nieuwe soorten', cmp_species_lost:'Verloren soorten',
      cmp_nocturnal:'Nachtelijke detecties', cmp_nocturnal_sub:'22u – 4u',
      cmp_none:'Geen', cmp_per_day:'/d', cmp_change:'Wijziging',
      cmp_species_detail:'Vergelijking per soort', cmp_count:'Aantal',
      del_manage:'Detecties beheren', del_this:'Deze detectie verwijderen',
      del_all:'Alles verwijderen', del_confirm_title:'Onomkeerbare verwijdering',
      del_confirm_body:'Dit verwijdert {count} detecties en alle audiobestanden voor "{name}". Deze actie kan niet ongedaan worden gemaakt.',
      del_type_name:'Typ "{name}" om te bevestigen:',
      del_permanently:'Definitief verwijderen', cancel:'Annuleren',
      del_one_confirm:'Detectie van {date} om {time} verwijderen (betrouwbaarheid: {conf})?\n\nHet audiobestand wordt ook verwijderd.',
      del_success:'detecties verwijderd', del_file_errors:'bestanden konden niet worden verwijderd',
      del_done_title:'Verwijdering voltooid', del_records_removed:'Detecties verwijderd',
      del_files_removed:'Bestanden verwijderd', del_close:'Sluiten',
      avg_conf_short:'Gem. betrouwbaarheid', days_detected:'Detectiedagen',
      activity_30d:'Activiteit — 30 dagen', conf_distribution:'Betrouwbaarheidsverdeling',
      activity_month_hour:'Seizoensactiviteit per uur', description:'Beschrijving', description_en:'Beschrijving (Engels)',
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
      all_rarities:'Alle zeldzaamheden', updated_at:'Bijgewerkt', ebird_notable_title:'eBird — Opmerkelijke waarnemingen', bw_period_today:'Vandaag', bw_period_week:'7d', bw_period_month:'30d', bw_period_all:'Alles', unit_d:'d', unit_h:'u', unit_m:'m',
      no_notable_obs:'Geen opmerkelijke waarnemingen in de afgelopen 7 dagen.',
      quick_today:'Vandaag',
      sys_tab_health:'Status', sys_tab_model:'Model', sys_tab_data:'Gegevens', sys_tab_external:'Extern',
      sys_health_title:'Systeemstatus', sys_cpu:'CPU', sys_ram:'RAM', sys_disk:'Schijf',
      sys_temp:'Temperatuur', sys_fan:'Ventilator', sys_uptime_label:'Uptime', sys_load:'Belasting',
      sys_cores:'kernen',
      sys_services_title:'Services', sys_svc_logs:'Logboek', sys_svc_no_logs:'Geen logboek',
      sys_confirm_stop:'Stop bevestigen', sys_confirm_stop_msg:'Service "{name}" stoppen? Dit kan de analyse onderbreken.',
      sys_cancel:'Annuleren', sys_svc_starting:'Starten…', sys_svc_stopping:'Stoppen…',
      sys_analysis_title:'Analysestatus', sys_backlog:'Achterstand', sys_lag:'Vertraging',
      sys_inference:'Inferentie', sys_model_active:'Actief model',
      sys_files_pending:'bestanden in wacht', sys_seconds:'seconden', sys_minutes:'min',
      sys_audio_title:'Audio', sys_rec_card:'Invoerkaart', sys_channels_label:'Kanalen', sys_format:'Formaat',
      sys_backup_title:'Back-up', sys_backup_dest:'Bestemming', sys_backup_mount:'Mount', sys_last_backup:'Laatste back-up',
      sys_backup_size:'Grootte', sys_mounted:'Gemount', sys_not_mounted:'Niet gemount', sys_not_configured:'Niet geconfigureerd',
      set_backup:'Back-up', set_backup_dest:'Bestemming', set_backup_content:'Te back-uppen inhoud',
      set_backup_dest_local:'USB-schijf / Lokaal', set_backup_dest_smb:'SMB/CIFS-share', set_backup_dest_nfs:'NFS-mount',
      set_backup_dest_sftp:'SFTP', set_backup_dest_s3:'Amazon S3', set_backup_dest_gdrive:'Google Drive',
      set_backup_dest_webdav:'WebDAV', set_backup_content_db:'Database', set_backup_content_audio:'Audiobestanden',
      set_backup_content_config:'Configuratie', set_backup_content_all:'Alles back-uppen',
      set_backup_path:'Pad / Mountpunt', set_backup_host:'Server', set_backup_port:'Poort',
      set_backup_user:'Gebruikersnaam', set_backup_pass:'Wachtwoord', set_backup_share:'Share',
      set_backup_bucket:'Bucket', set_backup_region:'Regio', set_backup_access_key:'Toegangssleutel',
      set_backup_secret_key:'Geheime sleutel', set_backup_remote_path:'Extern pad',
      set_backup_schedule:'Planning', set_backup_schedule_manual:'Alleen handmatig',
      set_backup_schedule_daily:'Dagelijks', set_backup_schedule_weekly:'Wekelijks',
      set_backup_schedule_time:'Back-uptijd', set_backup_retention:'Bewaren (dagen)',
      set_backup_run_now:'Nu uitvoeren', set_backup_running:'Back-up bezig…',
      set_backup_save:'Back-upconfiguratie opslaan',
      set_backup_saved:'Back-upconfiguratie opgeslagen',
      set_backup_last_status:'Laatste status', set_backup_never:'Nooit uitgevoerd',
      set_backup_success:'Succesvol', set_backup_failed:'Mislukt',
      set_backup_gdrive_folder:'Google Drive map-ID',
      set_backup_state_running:'Bezig', set_backup_state_completed:'Voltooid',
      set_backup_state_failed:'Mislukt', set_backup_state_stopped:'Gestopt',
      set_backup_state_paused:'Gepauzeerd',
      set_backup_step:'Stap', set_backup_started:'Gestart',
      set_backup_pause:'Pauze', set_backup_resume:'Hervatten', set_backup_stop:'Stoppen',
      set_backup_stop_confirm:'Lopende back-up stoppen? (rsync hervat bij volgende run)',
      set_backup_transferred:'Overgedragen', set_backup_disk_free:'Vrije ruimte',
      sys_network_title:'Netwerk', sys_hostname:'Hostnaam', sys_ip:'IP-adres',
      sys_gateway:'Gateway', sys_internet:'Internet',
      sys_nas_ping:'NAS-ping', sys_reachable:'Bereikbaar', sys_unreachable:'Onbereikbaar',
      sys_hardware_title:'Hardware',
      nav_prev_day:'Vorige dag', nav_next_day:'Volgende dag',
      select_species_prompt:'Selecteer een soort', listen_spectro_hint:'om te luisteren en het spectrogram te bekijken',
      next_det_audio:'Volgende detectie met audio →',
      download:'Downloaden', download_audio:'Audio downloaden',
      ebird_export:'eBird-export',
      click_to_edit_value:'Klik om waarde in te voeren',
      search_filter_ph:'filteren…', search_species_ph:'Zoeken… (druk /)',
      fft_analysis:'FFT-analyse…',
      ebird_api_missing:'API-sleutel ontbreekt',
      ebird_enable_text:'Om deze sectie te activeren, haal een gratis sleutel op bij',
      ebird_then_configure:'en configureer deze op de Pi:',
      ebird_add_env:'Toevoegen:', ebird_your_key:'uw_sleutel',
      ebird_no_notable:'Geen opmerkelijke waarnemingen in de afgelopen 7 dagen.',
      ebird_see_on:'Bekijk op eBird', bw_see_on:'Bekijk op BirdWeather',
      bw_add_in:'Toevoegen in', bw_id_in_url:'De ID is zichtbaar in de URL:',
      top_detected:'Top gedetecteerde soorten',
      detected_locally:'Ook lokaal gedetecteerd', not_detected_locally:'Niet lokaal gedetecteerd',
      no_rarities_detected:'Geen zeldzaamheden recent gedetecteerd',
      search_placeholder:'Soort zoeken\u2026',
      // Lifers
      lifers_label:'Lifers', no_lifers:'Geen lifers voor deze datum',
      // Morning summary (legacy)
      morning_summary:'Wat is er nieuw', new_today:'Nieuw vandaag', best_detection:'Beste detectie',
      vs_yesterday:'vs gisteren', no_new_species:'Geen nieuwe soorten',
      // What's New module
      wn_title:'Nieuw vandaag',
      wn_level_alerts:'Meldingen', wn_level_phenology:'Fenologie', wn_level_context:'Context van vandaag',
      wn_card_out_of_season:'Soort buiten seizoen', wn_card_activity_spike:'Activiteitspiek',
      wn_card_species_return:'Soort teruggekeerd', wn_card_first_of_year:'Eerste van het jaar',
      wn_card_species_streak:'Aaneengesloten aanwezigheid', wn_card_seasonal_peak:'Seizoenspiek',
      wn_card_dawn_chorus:'Dageraadskoor', wn_card_acoustic_quality:'Akoestische kwaliteit',
      wn_card_species_richness:'Soortendiversiteit', wn_card_moon_phase:'Maanfase',
      wn_insuf_label:'Onvoldoende gegevens',
      wn_insuf_needsWeek:'Deze kaart vereist minimaal 7 dagen aan detecties.',
      wn_insuf_needsTwoWeeks:'Deze kaart vereist minimaal 15 dagen detecties.',
      wn_insuf_needsMonth:'Deze kaart vereist minimaal 28 dagen gegevens.',
      wn_insuf_needsSeason:'Deze kaart vereist minimaal een jaar aan gegevens.',
      wn_insuf_needsGPS:'GPS-coördinaten niet ingesteld. Stel LATITUDE en LONGITUDE in /etc/birdnet/birdnet.conf in.',
      wn_insuf_tooEarly:'Nog niet genoeg detecties vandaag. Kom later terug.',
      wn_moon_new_moon:'Nieuwe maan', wn_moon_waxing_crescent:'Wassende sikkel',
      wn_moon_first_quarter:'Eerste kwartier', wn_moon_waxing_gibbous:'Wassende maan',
      wn_moon_full_moon:'Volle maan', wn_moon_waning_gibbous:'Afnemende maan',
      wn_moon_last_quarter:'Laatste kwartier', wn_moon_waning_crescent:'Afnemende sikkel',
      wn_migration_favorable:'Gunstige migratie', wn_migration_moderate:'Matige migratie', wn_migration_limited:'Beperkte migratie',
      wn_quality_good:'Goed', wn_quality_moderate:'Matig', wn_quality_poor:'Slecht',
      wn_trend_above:'Boven gemiddeld', wn_trend_normal:'Normaal', wn_trend_below:'Onder gemiddeld',
      wn_spike_ratio:'× gemiddelde', wn_streak_days:'opeenvolgende dagen', wn_absent_days:'dagen afwezig',
      wn_species_detected:'soorten gedetecteerd', wn_detections:'detecties', wn_vs_avg:'vs gem.',
      wn_illumination:'Verlichting', wn_acceptance_rate:'Acceptatiegraad', wn_strong_detections:'Sterke detecties',
      // Phenology & quick play
      phenology:'Fenologie', first_arrival:'Eerste aankomst', last_departure:'Laatste vertrek', quick_play:'Snel afspelen',
      // Validation
      validation_confirmed:'Bevestigd', validation_doubtful:'Twijfelachtig', validation_rejected:'Afgewezen', validation_unreviewed:'Niet beoordeeld',
      hide_rejected:'Afgewezen verbergen', validation_stats:'Validatiestatistieken',
      // Timeline
      tl_title:'Dagboek', tl_notable:'opmerkelijke gebeurtenissen', tl_full_view:'Volledige weergave',
      tl_see_full:'Volledige tijdlijn bekijken', tl_loading:'Laden…',
      tl_prev_day:'Vorige dag', tl_next_day:'Volgende dag',
      tl_species:'soorten', tl_detections:'detecties', tl_chronology:'Chronologie van gebeurtenissen',
      tl_see_species:'Soortkaart bekijken', tl_see_today:'Dag bekijken', tl_listen:'Luisteren', tl_validate:'Bevestigen',
      tl_density_label:'Detectie-intensiteit', tl_density_label_short:'Vogels', tl_now:'nu', tl_drag_hint:'sleep om te zoomen',
      tl_type_nocturnal:'🌙 Nachtelijk', tl_type_rare:'⭐ Zeldzaam', tl_type_firstyear:'🌱 Eerste dit jaar',
      tl_type_firstday:'🐦 Eerste overdag', tl_type_best:'🎵 Beste detectie', tl_type_out_of_season:'⚠️ Buiten seizoen', tl_type_species_return:'🔄 Terug', tl_type_top_species:'🐦 Soorten',
      tl_density_0:'Heel weinig', tl_density_1:'Weinig', tl_density_2:'Normaal', tl_density_3:'Meer', tl_density_4:'Maximum', tl_density_5:'Alles',
      tl_tag_nocturnal:'Nachtelijk', tl_tag_strict_nocturnal:'Strikt nachtelijk',
      tl_tag_migration:'Migratie', tl_tag_out_of_season:'Buiten seizoen',
      tl_tag_rare:'Zeldzaam', tl_tag_firstyear:'Eerste dit jaar', tl_tag_firstday:'Eerste overdag', tl_tag_best:'Beste betrouwbaarheid',
      tl_tag_species_return:'Terug', tl_tag_activity_spike:'Activiteitspiek', tl_tag_top_species:'Topsoort',
      tl_sunrise:'Opkomst', tl_sunset:'Ondergang', tl_confidence:'Betrouwbaarheid',
    },
  };

  // ── Singletons réactifs (partagés dans toute l'app) ───────────────────────
  // Un seul ref par page — Vue garantit que tous les composables qui y accèdent
  // voient le même changement et réagissent de façon coordonnée.
  // Migrate old keys (birdash-theme → birdash_theme)
  if (localStorage.getItem('birdash-theme') && !localStorage.getItem('birdash_theme')) {
    localStorage.setItem('birdash_theme', localStorage.getItem('birdash-theme'));
    localStorage.removeItem('birdash-theme');
  }

  const _lang  = ref(localStorage.getItem('birdash_lang')  || 'fr');
  const _theme = ref(localStorage.getItem('birdash_theme') || 'forest');

  // Appliquer le thème et la langue immédiatement au chargement
  document.documentElement.setAttribute('data-theme', _theme.value);
  document.documentElement.lang = _lang.value;

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
      document.documentElement.lang = code;
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
      localStorage.setItem('birdash_theme', id);
      document.documentElement.setAttribute('data-theme', id);
    }
    return { theme: _theme, themes: THEMES, setTheme };
  }

  // ── Global site identity (shared across all useNav calls) ────────────────
  const _siteName  = ref('BirdStation');
  const _brandName = ref('BirdStation');
  let _siteIdentityLoaded = false;

  function _loadSiteIdentity() {
    if (_siteIdentityLoaded) return;
    _siteIdentityLoaded = true;
    // Init from config
    _siteName.value = BIRD_CONFIG.siteName || (BIRD_CONFIG.location && BIRD_CONFIG.location.name) || 'BirdStation';
    _brandName.value = BIRD_CONFIG.brandName || 'BirdStation';
    // Override from API
    fetch(BIRD_CONFIG.apiUrl + '/settings').then(r => r.ok ? r.json() : {}).then(conf => {
      if (conf.SITE_NAME) {
        _siteName.value = conf.SITE_NAME;
        const pageTitle = document.title.replace(/^[^—]+—/, _siteName.value + ' —');
        if (pageTitle !== document.title) document.title = pageTitle;
      }
      if (conf.SITE_BRAND) _brandName.value = conf.SITE_BRAND;
    }).catch(() => {});
  }

  // Update site identity (called from settings page after save)
  function updateSiteIdentity(name, brand) {
    if (name != null) {
      _siteName.value = name;
      const pageTitle = document.title.replace(/^[^—]+—/, name + ' —');
      if (pageTitle !== document.title) document.title = pageTitle;
    }
    if (brand != null) _brandName.value = brand;
  }

  // ── useNav ────────────────────────────────────────────────────────────────
  const NAV_KEYS = {
    index:        'nav_overview',
    today:        'nav_today',
    timeline:     'tl_title',
    recent:       'nav_recent',
    detections:   'nav_detections',
    species:      'nav_species',
    biodiversity: 'nav_biodiversity',
    rarities:     'nav_rarities',
    stats:        'nav_stats',
    analyses:     'nav_analyses',
    models:       'nav_models',
    review:       'nav_review',
    gallery:      'nav_gallery',
    spectrogram:  'nav_spectrogram',
    recordings:   'nav_recordings',
    settings:     'nav_settings',
    system:       'nav_system',
  };

  function useNav(pageId) {
    const { t } = useI18n();
    const navSections = computed(() =>
      (BIRD_CONFIG.nav || []).map(sec => ({
        section: t(sec.section),
        icon: sec.icon || '',
        items: sec.items.map(p => ({
          ...p,
          label:  t(NAV_KEYS[p.id] || p.id),
          active: p.id === pageId,
        })),
      }))
    );
    // Flat list for backwards compat
    const navItems = computed(() => navSections.value.flatMap(s => s.items));
    _loadSiteIdentity();
    return { navItems, navSections, siteName: _siteName, brandName: _brandName };
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

  /** Export a canvas chart as PNG download. */
  function exportChart(canvasRef, filename) {
    const canvas = canvasRef.value || canvasRef;
    if (!canvas || !canvas.toDataURL) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (filename || 'chart') + '.png';
    a.click();
  }

  // ── Utility references from bird-shared.js (BIRDASH_UTILS) ──────────────
  // Pure utility functions are defined in bird-shared.js and accessed via U.
  // Wrappers below provide backward compatibility and inject reactive state
  // (e.g. current language) where needed.

  // buildSpeciesLinks wrapper: auto-injects current reactive language
  function buildSpeciesLinks(comName, sciName) {
    return U.buildSpeciesLinks(comName, sciName, _lang.value);
  }

  // ── useToast ────────────────────────────────────────────────────────────
  const _toasts = ref([]);
  let _toastId = 0;

  function useToast() {
    function show(msg, type = 'error', duration = 4000) {
      const id = ++_toastId;
      _toasts.value.push({ id, msg, type });
      setTimeout(() => {
        _toasts.value = _toasts.value.filter(t => t.id !== id);
      }, duration);
    }
    // Listen for global error events
    if (typeof window !== 'undefined') {
      window.addEventListener('birdash:error', (e) => {
        show(e.detail || 'Unknown error', 'error');
      });
      window.addEventListener('birdash:success', (e) => {
        show(e.detail || 'OK', 'success', 2500);
      });
    }
    return { toasts: _toasts, showToast: show };
  }

  // ── useFavorites ────────────────────────────────────────────────────────
  function useFavorites() {
    const favorites = ref(U.getFavorites());

    // Load from DB on first use
    U.loadFavorites().then(() => { favorites.value = U.getFavorites(); });

    async function toggle(comName, sciName) {
      await U.toggleFavorite(comName, sciName);
      favorites.value = U.getFavorites();
    }

    function isFav(comName) {
      return favorites.value.includes(comName);
    }

    return { favorites, toggleFavorite: toggle, isFavorite: isFav };
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

  // ── Filter composables ───────────────────────────────────────────────────
  // Reusable, standardised filter logic for all pages.

  /**
   * useFilterPeriod — date range + quick-period buttons.
   * @param {Object} opts
   * @param {string}   opts.default       - initial period key ('1d','7d','30d','90d','6m','1y','all')
   * @param {string[]} opts.buttons       - which quick buttons to show (default all 7)
   * @param {Function} opts.onChange       - called after any change
   */
  function useFilterPeriod(opts = {}) {
    const { t } = useI18n();
    const defaultPeriod = opts.default || '7d';
    const btnKeys = opts.buttons || ['1d','7d','30d','90d','1y','all'];

    const period   = ref(defaultPeriod);
    const dateFrom = ref('');
    const dateTo   = ref('');

    const PERIOD_LABELS = { '1d':'quick_1d','7d':'quick_7d','30d':'quick_30d','90d':'quick_90d',
      '1m':'quick_1m','3m':'quick_3m','6m':'quick_6m','1y':'quick_1y','all':'quick_all' };
    const PERIOD_DAYS = { '1d':0,'7d':6,'30d':29,'1m':29,'90d':89,'3m':89,'6m':179,'1y':364,'all':null };

    function periodToDates(key) {
      const today = U.localDateStr();
      if (key === 'all') return { from: '1900-01-01', to: today };
      const days = PERIOD_DAYS[key];
      return { from: days != null ? U.daysAgo(days) : '', to: today };
    }

    function setPeriod(key) {
      period.value = key;
      const d = periodToDates(key);
      dateFrom.value = d.from;
      dateTo.value   = d.to;
      if (opts.onChange) opts.onChange();
    }

    function setCustomRange(from, to) {
      period.value   = 'custom';
      dateFrom.value = from;
      dateTo.value   = to;
      if (opts.onChange) opts.onChange();
    }

    const quickButtons = computed(() =>
      btnKeys.map(key => ({
        key,
        label: t(PERIOD_LABELS[key] || key),
        active: period.value === key
      }))
    );

    // Initialise dates from default period
    const init = periodToDates(defaultPeriod);
    dateFrom.value = init.from;
    dateTo.value   = init.to;

    return { period, dateFrom, dateTo, quickButtons, setPeriod, setCustomRange };
  }

  /**
   * useFilterConfidence — slider + editable percentage.
   * @param {Object} opts
   * @param {number} opts.default  - initial value 0-1 (default: BIRD_CONFIG.defaultConfidence)
   * @param {Function} opts.onChange
   */
  function useFilterConfidence(opts = {}) {
    const confidence  = ref(opts.default != null ? opts.default : BIRD_CONFIG.defaultConfidence);
    const confEditing = ref(false);
    const confEditVal = ref(Math.round(confidence.value * 100));
    const confInput   = ref(null); // template ref

    function startEdit() {
      confEditVal.value = Math.round(confidence.value * 100);
      confEditing.value = true;
      nextTick(() => { if (confInput.value) { confInput.value.select(); } });
    }
    function commitEdit() {
      let v = parseInt(confEditVal.value, 10);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      confidence.value  = v / 100;
      confEditing.value = false;
      if (opts.onChange) opts.onChange();
    }

    return { confidence, confEditing, confEditVal, confInput, startEdit, commitEdit };
  }

  /**
   * useFilterSpecies — multi-select or search-only species filter.
   * @param {Object} opts
   * @param {import('vue').Ref} opts.source  - ref to [{name, sci, count}]
   * @param {Function} opts.spName           - translation function (comName, sciName) → string
   * @param {Function} opts.onChange
   */
  function useFilterSpecies(opts = {}) {
    const selectedSpecies = ref([]);
    const speciesSearch   = ref('');

    const filteredList = computed(() => {
      const src = opts.source ? opts.source.value : [];
      const q = speciesSearch.value.toLowerCase();
      if (!q) return src;
      const spN = opts.spName || ((n) => n);
      return src.filter(s =>
        spN(s.name, s.sci).toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
      );
    });

    const allSelected = computed(() =>
      opts.source && opts.source.value.length > 0 &&
      selectedSpecies.value.length === opts.source.value.length
    );

    function toggleAll() {
      if (allSelected.value) {
        selectedSpecies.value = [];
      } else {
        selectedSpecies.value = (opts.source ? opts.source.value : []).map(s => s.name);
      }
      if (opts.onChange) opts.onChange();
    }

    function toggleSpecies(name) {
      const idx = selectedSpecies.value.indexOf(name);
      if (idx >= 0) selectedSpecies.value.splice(idx, 1);
      else selectedSpecies.value.push(name);
      if (opts.onChange) opts.onChange();
    }

    function removeSpecies(name) {
      const idx = selectedSpecies.value.indexOf(name);
      if (idx >= 0) selectedSpecies.value.splice(idx, 1);
      if (opts.onChange) opts.onChange();
    }

    return { selectedSpecies, speciesSearch, filteredList, allSelected, toggleAll, toggleSpecies, removeSpecies };
  }

  /**
   * buildWhereClause — shared SQL WHERE builder.
   * @param {Object} filters
   * @param {string[]} filters.species    - Com_Name list (empty = no filter)
   * @param {string}   filters.dateFrom
   * @param {string}   filters.dateTo
   * @param {number}   filters.confidence - 0-1
   * @param {string[]} filters.extraWhere - additional raw clauses
   * @param {any[]}    filters.extraParams
   * @returns {{ where: string, params: any[] }}
   */
  function buildWhereClause(filters = {}) {
    const clauses = ['1=1'];
    const params  = [];
    if (filters.species && filters.species.length) {
      if (filters.species.length === 1) {
        clauses.push('Com_Name = ?'); params.push(filters.species[0]);
      } else {
        clauses.push('Com_Name IN (' + filters.species.map(() => '?').join(',') + ')');
        params.push(...filters.species);
      }
    }
    if (filters.dateFrom) { clauses.push('Date >= ?'); params.push(filters.dateFrom); }
    if (filters.dateTo)   { clauses.push('Date <= ?'); params.push(filters.dateTo); }
    if (filters.confidence > 0) { clauses.push('Confidence >= ?'); params.push(filters.confidence); }
    if (filters.extraWhere) {
      for (let i = 0; i < filters.extraWhere.length; i++) {
        clauses.push(filters.extraWhere[i]);
      }
    }
    if (filters.extraParams) params.push(...filters.extraParams);
    return { where: clauses.join(' AND '), params };
  }

  // ── Composant PibirdShell ─────────────────────────────────────────────────
  // Encapsule le header, la navigation, les switchers thème/langue et le <main>.
  // Usage : <birdash-shell page="species"> … contenu … </birdash-shell>
  // ── Model display names ────────────────────────────────────────────────
  const MODEL_LABELS = {
    'BirdNET_GLOBAL_6K_V2.4_Model_FP16': 'BirdNET V2.4',
    'BirdNET_6K_GLOBAL_MODEL':           'BirdNET V1',
    'Perch_v2':                          'Perch V2',
    'Perch_v2_int8':                     'Perch V2 INT8',
    'perch_v2_original':                 'Perch V2 (FP32)',
    'perch_v2_fp16':                     'Perch V2 (FP16)',
    'perch_v2_dynint8':                  'Perch V2 (INT8)',
    'BirdNET-Go_classifier_20250916':    'BirdNET-Go',
  };

  const PibirdShell = {
    props: {
      page:  { type: String, default: '' },
      title: { type: String, default: '' },
    },
    setup(props) {
      const { lang, t, setLang, langs } = useI18n();
      const { theme, themes, setTheme } = useTheme();
      const { navItems, navSections, siteName, brandName } = useNav(props.page);
      const { toasts } = useToast();
      // Open the section containing the current page by default
      const openSection = ref(
        (BIRD_CONFIG.nav || []).findIndex(sec => sec.items.some(p => p.id === props.page))
      );
      function navSectionClick(si) {
        if (openSection.value === si) { openSection.value = -1; return; }
        openSection.value = si;
      }
      const { spName, spNamesReady }    = useSpeciesNames();
      const langOpen = ref(false);
      const themeOpen = ref(false);
      const currentLang = computed(() => langs.find(l => l.code === lang.value) || langs[0]);
      const currentTheme = computed(() => themes.find(th => th.id === theme.value) || themes[0]);
      const modelName = ref('');
      // Fetch active model from settings (non-blocking)
      fetch(`${BIRD_CONFIG.apiUrl}/settings`).then(r => r.json()).then(conf => {
        const raw = conf.MODEL || '';
        const primary = MODEL_LABELS[raw] || raw.replace(/_/g, ' ');
        if (conf.DUAL_MODEL_ENABLED === '1' && conf.SECONDARY_MODEL) {
          const sec = MODEL_LABELS[conf.SECONDARY_MODEL] || conf.SECONDARY_MODEL.replace(/_/g, ' ');
          modelName.value = primary + ' + ' + sec;
        } else {
          modelName.value = primary;
        }
      }).catch(() => {});

      // ── Global search bar ──────────────────────────────────────────────
      const searchQuery = ref('');
      const searchOpen = ref(false);
      const searchExpanded = ref(false);
      const searchHighlight = ref(-1);
      const searchInputRef = ref(null);
      const dbSpecies = ref([]);

      // Load species list from DB once
      U.birdQuery('SELECT DISTINCT Com_Name, Sci_Name FROM detections ORDER BY Com_Name')
        .then(rows => { dbSpecies.value = rows; })
        .catch(() => {});

      // Parse date from search query (e.g. "3 avril", "03/04", "2026-04-03")
      const _months = {
        jan:1,fev:2,fév:2,feb:2,mar:3,avr:4,apr:4,mai:5,may:5,jun:6,juin:6,jul:7,juil:7,
        aug:8,aou:8,aoû:8,sep:9,oct:10,nov:11,dec:12,déc:12
      };
      function _parseDate(q) {
        // YYYY-MM-DD
        let m = q.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
        // DD/MM or DD/MM/YYYY
        m = q.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
        if (m) { const y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : new Date().getFullYear(); return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
        // "3 avril" or "avril 3"
        m = q.match(/(\d{1,2})\s+([a-zéûô]+)/i) || q.match(/([a-zéûô]+)\s+(\d{1,2})/i);
        if (m) {
          const day = m[1].match(/\d/) ? m[1] : m[2];
          const mon = m[1].match(/\d/) ? m[2] : m[1];
          const mk = mon.toLowerCase().substring(0,3);
          if (_months[mk]) return `${new Date().getFullYear()}-${String(_months[mk]).padStart(2,'0')}-${day.padStart(2,'0')}`;
        }
        return null;
      }

      const searchResults = computed(() => {
        const q = (searchQuery.value || '').trim().toLowerCase();
        if (!q) return [];
        const results = [];

        // Check for date in query
        const parsedDate = _parseDate(q);
        if (parsedDate) {
          const dateLabel = new Date(parsedDate+'T12:00:00').toLocaleDateString(_lang.value, {weekday:'long',day:'numeric',month:'long'});
          results.push({ type:'date', date: parsedDate, displayName: '📆 ' + dateLabel, comName: '' });
        }

        // Species search (filter out date tokens)
        const speciesQ = parsedDate ? q.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\s]\d{1,2}([\/.\s]\d{2,4})?|\d{1,2}\s+[a-zéûô]+|[a-zéûô]+\s+\d{1,2}/gi, '').trim() : q;
        const seen = new Set();
        for (const row of dbSpecies.value) {
          const com = row.Com_Name || '';
          const sci = row.Sci_Name || '';
          const translated = spName(com, sci);
          const sq = speciesQ || q;
          if (translated.toLowerCase().includes(sq) || com.toLowerCase().includes(sq) || sci.toLowerCase().includes(sq)) {
            const key = sci || com;
            if (!seen.has(key)) {
              seen.add(key);
              const r = { type:'species', comName: com, sciName: sci, displayName: translated };
              if (parsedDate) { r.type = 'species+date'; r.date = parsedDate; r.displayName += ' 📆'; }
              results.push(r);
              if (results.length >= 8) break;
            }
          }
        }
        return results;
      });

      function onSearchInput() {
        searchOpen.value = searchQuery.value.trim().length > 0;
        searchHighlight.value = -1;
      }

      function selectSearchResult(result) {
        if (result.type === 'date') {
          window.location.href = 'calendar.html?date=' + result.date;
        } else if (result.type === 'species+date') {
          window.location.href = 'calendar.html?date=' + result.date + '&species=' + encodeURIComponent(result.comName);
        } else {
          window.location.href = 'species.html?species=' + encodeURIComponent(result.comName);
        }
      }

      function onSearchKeydown(e) {
        const results = searchResults.value;
        if (e.key === 'Escape') {
          searchOpen.value = false;
          searchQuery.value = '';
          searchExpanded.value = false;
          e.target.blur();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          searchHighlight.value = Math.min(searchHighlight.value + 1, results.length - 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          searchHighlight.value = Math.max(searchHighlight.value - 1, -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (searchHighlight.value >= 0 && searchHighlight.value < results.length) {
            selectSearchResult(results[searchHighlight.value]);
          } else if (results.length === 1) {
            selectSearchResult(results[0]);
          }
        }
      }

      function closeSearch() {
        searchOpen.value = false;
        searchExpanded.value = false;
        searchQuery.value = '';
        searchHighlight.value = -1;
      }

      function toggleMobileSearch() {
        searchExpanded.value = !searchExpanded.value;
        if (searchExpanded.value) {
          nextTick(() => {
            const inp = document.querySelector('.gSearch-input');
            if (inp) inp.focus();
          });
        } else {
          closeSearch();
        }
      }

      // ── Notification bell ────────────────────────────────────────────
      const bellOpen = ref(false);
      const bellItems = ref([]);
      const bellCount = computed(() => bellItems.value.length);
      const bellSeen = ref(parseInt(localStorage.getItem('birdash_bell_seen') || '0', 10));
      const bellUnseen = computed(() => Math.max(0, bellCount.value - bellSeen.value));

      fetch(`${BIRD_CONFIG.apiUrl}/whats-new`).then(r => r.json()).then(d => {
        const items = [];
        const icons = { out_of_season: '⚠️', activity_spike: '📈', species_return: '🔄', first_of_year: '🆕', species_streak: '📅', seasonal_peak: '🌿' };
        const allCards = [...(d.alerts || []), ...(d.phenology || [])];
        for (const card of allCards) {
          if (!card.active || !card.data?.species) continue;
          const icon = icons[card.type] || '🔔';
          const label = t('wn_card_' + card.type) || card.type;
          for (const sp of card.data.species) {
            const name = sp.commonName || sp.comName || '';
            const sci = sp.sciName || '';
            let sub = label;
            if (sp.absentDays) sub += ' (' + sp.absentDays + 'j)';
            if (sp.streakDays) sub += ' (' + sp.streakDays + 'j)';
            if (sp.count) sub += ' (' + sp.count + ')';
            items.push({ icon, text: spName(name, sci) || name, sub, href: 'species.html?species=' + encodeURIComponent(name) });
          }
        }
        bellItems.value = items.slice(0, 12);
      }).catch(() => {});

      function toggleBell() {
        bellOpen.value = !bellOpen.value;
        if (bellOpen.value) {
          bellSeen.value = bellCount.value;
          localStorage.setItem('birdash_bell_seen', String(bellCount.value));
        }
      }

      const currentPage = props.page;

      // Review badge count
      const reviewCount = ref(0);
      function refreshReviewCount() {
        fetch(`${BIRD_CONFIG.apiUrl}/flagged-detections?dateFrom=1900-01-01&dateTo=${U.localDateStr()}&limit=2000`)
          .then(r => r.json()).then(d => { reviewCount.value = d.total || 0; }).catch(() => {});
      }
      refreshReviewCount();
      window.addEventListener('birdash:review-changed', refreshReviewCount);

      return { lang, t, setLang, langs, theme, themes, setTheme, navItems, navSections, openSection, navSectionClick, siteName, langOpen, themeOpen, currentLang, currentTheme, modelName, currentPage, reviewCount, searchQuery, searchOpen, searchExpanded, searchHighlight, searchResults, onSearchInput, selectSearchResult, onSearchKeydown, closeSearch, toggleMobileSearch, bellOpen, bellItems, bellCount, bellUnseen, toggleBell, toasts, brandName, refreshReviewCount };
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
      <img src="img/robin-logo.svg" class="brand-logo" :alt="brandName">
      <div class="brand-text">
        <span class="brand-name">{{brandName}}</span>
        <span class="brand-sub">{{siteName}}</span>
      </div>
    </div>
    <div class="header-right">
      <a v-if="modelName" class="brand-model" href="settings.html#detection" title="Detection settings">{{modelName}}</a>
      <!-- Global species search -->
      <div class="gSearch" :class="{ expanded: searchExpanded }" v-click-outside="closeSearch">
        <button class="gSearch-icon-btn" @click="toggleMobileSearch" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <div class="gSearch-field">
          <svg class="gSearch-lens" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="gSearch-input" type="text"
                 :placeholder="t('search_placeholder')"
                 v-model="searchQuery"
                 @input="onSearchInput"
                 @keydown="onSearchKeydown"
                 @focus="searchOpen = searchQuery.trim().length > 0"
                 autocomplete="off" spellcheck="false">
          <button v-if="searchQuery" class="gSearch-clear" @click="searchQuery='';searchOpen=false;searchHighlight=-1" aria-label="Clear">&times;</button>
        </div>
        <div class="gSearch-dropdown" v-show="searchOpen && searchResults.length">
          <button v-for="(r, i) in searchResults" :key="r.sciName||r.comName"
                  class="gSearch-result" :class="{ highlighted: i === searchHighlight }"
                  @mousedown.prevent="selectSearchResult(r)"
                  @mouseenter="searchHighlight = i">
            <span class="gSearch-rname">{{ r.displayName }}</span>
            <span class="gSearch-rsci">{{ r.sciName }}</span>
          </button>
        </div>
      </div>
      <!-- Notification bell -->
      <div class="hdr-bell" v-click-outside="()=>bellOpen=false">
        <button class="bell-btn" @click="toggleBell" :aria-label="t('notifications')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span v-if="bellUnseen > 0" class="bell-badge">{{bellUnseen}}</span>
        </button>
        <div class="bell-panel" v-show="bellOpen">
          <div v-if="bellItems.length === 0" style="padding:1rem;text-align:center;opacity:.5;font-size:.8rem;">{{t('wn_empty')}}</div>
          <a v-for="(item, i) in bellItems" :key="i" :href="item.href" class="bell-item">
            <span class="bell-icon">{{item.icon}}</span>
            <div class="bell-text">
              <div class="bell-name">{{item.text}}</div>
              <div class="bell-sub">{{item.sub}}</div>
            </div>
          </a>
        </div>
      </div>
      <div class="header-dropdowns">
        <div class="hdr-dropdown" :class="{open:themeOpen}" v-click-outside="()=>themeOpen=false">
          <button class="hdr-toggle" @click="themeOpen=!themeOpen" :aria-expanded="themeOpen">
            <span class="theme-dot" :data-t="theme"></span>
            <span class="hdr-label">{{currentTheme.label}}</span>
            <svg class="hdr-chevron" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div class="hdr-menu" v-show="themeOpen">
            <button v-for="th in themes" :key="th.id" class="hdr-option"
                    :class="{active:theme===th.id}"
                    @click="setTheme(th.id);themeOpen=false">
              <span class="theme-dot" :data-t="th.id"></span>
              <span class="hdr-option-label">{{th.label}}</span>
              <span class="hdr-check" v-if="theme===th.id">✓</span>
            </button>
          </div>
        </div>
        <div class="hdr-dropdown" :class="{open:langOpen}" v-click-outside="()=>langOpen=false">
          <button class="hdr-toggle" @click="langOpen=!langOpen" :aria-expanded="langOpen">
            <span class="lang-flag">{{currentLang.flag}}</span>
            <span class="hdr-label">{{lang.toUpperCase()}}</span>
            <svg class="hdr-chevron" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div class="hdr-menu" v-show="langOpen">
            <button v-for="l in langs" :key="l.code" class="hdr-option"
                    :class="{active:lang===l.code}"
                    @click="setLang(l.code);langOpen=false">
              <span class="lang-flag">{{l.flag}}</span>
              <span class="hdr-option-label">{{l.label}}</span>
              <span class="hdr-check" v-if="lang===l.code">✓</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
  <nav class="app-nav" aria-label="Navigation principale">
    <div class="nav-sections">
      <button v-for="(sec, si) in navSections" :key="si"
              class="nav-section-btn"
              :class="{active: openSection === si, 'has-active-page': sec.items.some(p => p.active)}"
              @click="navSectionClick(si)">
        <span class="nav-section-icon">{{sec.icon}}</span>
        {{sec.section}}
      </button>
    </div>
    <div v-if="openSection >= 0 && navSections[openSection]" class="nav-pages">
      <a v-for="p in navSections[openSection].items" :key="p.id" :href="p.file"
         class="nav-link" :class="{active:p.active}" :aria-current="p.active?'page':null">
        <span class="nav-icon" aria-hidden="true">{{p.icon}}</span>
        <span class="nav-label">{{p.label}}</span>
        <span v-if="p.id==='review' && reviewCount > 0" class="nav-badge">{{reviewCount}}</span>
      </a>
    </div>
  </nav>
  <main id="birdash-main" class="app-main" role="main">
    <h1 v-if="title" class="sr-only">{{title}}</h1>
    <slot></slot>
  </main>
  <spectro-modal></spectro-modal>
  <div v-if="toasts.length" style="position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:90vw;">
    <div v-for="t in toasts" :key="t.id" :style="{padding:'.5rem 1rem',borderRadius:'8px',fontSize:'.82rem',boxShadow:'0 2px 12px rgba(0,0,0,.3)',color:'#fff',background:t.type==='error'?'var(--danger,#e53935)':t.type==='success'?'var(--accent,#4caf50)':'var(--warning,#ff9800)'}">{{t.msg}}</div>
  </div>
  <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
    <a href="today.html" class="mob-nav-item" :class="{active: currentPage==='today'}"><span class="mob-nav-icon">📅</span>{{t('nav_today')}}</a>
    <a href="calendar.html" class="mob-nav-item" :class="{active: currentPage==='calendar'}"><span class="mob-nav-icon">📆</span>{{t('nav_calendar')}}</a>
    <a href="species.html" class="mob-nav-item" :class="{active: currentPage==='species'}"><span class="mob-nav-icon">🦜</span>{{t('nav_species')}}</a>
    <a href="weather.html" class="mob-nav-item" :class="{active: currentPage==='weather'}"><span class="mob-nav-icon">📊</span>{{t('nav_sec_insights')}}</a>
    <a href="settings.html" class="mob-nav-item" :class="{active: currentPage==='settings'}"><span class="mob-nav-icon">⚙️</span>{{t('nav_sec_system')}}</a>
  </nav>
</div>`
  };

  // ── Composant BirdImg ────────────────────────────────────────────────────
  // Image avec animation de chargement (3 dots wave).
  // Usage : <bird-img :src="url" :alt="text" class="my-class" />
  //         :src should be "/birds/api/photo?sci=Pica+pica" (server handles caching)
  const BirdImg = {
    props: {
      src:   { type: String, default: '' },
      alt:   { type: String, default: '' },
    },
    emits: ['refreshed'],
    setup(props, { emit }) {
      const loaded = ref(false);
      const errored = ref(false);
      const refreshing = ref(false);
      const imgSrc = ref(props.src);
      // Reset on src change
      watch(() => props.src, (v) => { loaded.value = false; errored.value = false; imgSrc.value = v; });
      function onLoad() { loaded.value = true; }
      function onError() { loaded.value = true; errored.value = true; }
      async function refreshPhoto() {
        if (refreshing.value || !props.src) return;
        // Extract sci name from URL (/api/photo?sci=X)
        const m = props.src.match(/[?&]sci=([^&]+)/);
        if (!m) return;
        const sci = decodeURIComponent(m[1]);
        refreshing.value = true;
        try {
          await fetch(BIRD_CONFIG.apiUrl + '/photo?sci=' + encodeURIComponent(sci), {
            method: 'DELETE', headers: U.authHeaders(),
          });
          // Force reload with cache-bust
          loaded.value = false;
          errored.value = false;
          imgSrc.value = props.src + (props.src.includes('?') ? '&' : '?') + '_t=' + Date.now();
          emit('refreshed');
        } catch(e) {}
        refreshing.value = false;
      }
      return { loaded, errored, refreshing, imgSrc, onLoad, onError, refreshPhoto };
    },
    template: `
      <div class="img-wrap">
        <div class="img-loader" :class="{ hidden: loaded }">
          <span></span><span></span><span></span>
        </div>
        <img v-if="imgSrc && !errored"
             :src="imgSrc" :alt="alt"
             :class="{ loaded: loaded }"
             @load="onLoad" @error="onError"
             loading="lazy">
        <div v-if="errored" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2rem;color:var(--text-faint);">🦜</div>
        <button v-if="loaded && !errored && imgSrc"
                class="img-refresh-btn" @click.stop="refreshPhoto"
                :disabled="refreshing" title="Refresh photo" aria-label="Refresh photo">🔄</button>
      </div>
    `
  };

  // ── Composant SpectroModal ──────────────────────────────────────────────
  // Full-screen spectrogram modal with audio playback, filters, and progress.
  // Opened via BIRDASH.openSpectroModal({ fileName, speciesName, ... })
  const SpectroModal = {
    setup() {
      const { t } = useI18n();
      const modal = _spectroModal;
      const loading = ref(false);
      const isPlaying = ref(false);
      const progress = ref(0);
      const currentTime = ref('0:00');
      const duration = ref('0:00');
      const filters = Vue.reactive({ gain: 0, highpass: 0, lowpass: 0 });
      const gainOpts = [0, 5, 10, 15, 20];
      const hpOpts = [0, 200, 500, 1000, 2000];
      const lpOpts = [0, 3000, 6000, 9000, 12000];

      const canvas = ref(null);
      let audioCtx = null;
      let sourceNode = null;
      let gainNode = null;
      let hpNode = null;
      let lpNode = null;
      let audioBuf = null;
      let startedAt = 0;
      let pausedAt = 0;
      let rafId = null;
      let pcmData = null;
      let sampleRate = 0;

      // Loop selection
      const loopStart = ref(null); // 0-1 fraction
      const loopEnd = ref(null);
      const loopActive = ref(false);
      let _dragging = false;
      let _dragStart = 0;

      const audioUrl = computed(() => modal.fileName ? U.buildAudioUrl(modal.fileName) : '');
      const downloadName = computed(() => modal.fileName || 'audio.wav');

      function fmtSec(s) {
        if (!s || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
      }

      async function loadAudio() {
        if (!modal.fileName) return;
        const url = audioUrl.value;
        if (!url) return;
        loading.value = true;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const arrBuf = await resp.arrayBuffer();
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          audioBuf = await ctx.decodeAudioData(arrBuf);
          sampleRate = audioBuf.sampleRate;
          pcmData = audioBuf.getChannelData(0);
          duration.value = fmtSec(audioBuf.duration);
          await ctx.close();
          // Render spectrogram
          if (canvas.value) {
            U.renderSpectrogram(pcmData, sampleRate, canvas.value, { fftSize: 1024, maxHz: 12000 });
          }
        } catch (e) {
          console.warn('SpectroModal: load error', e);
        }
        loading.value = false;
      }

      function buildFilterChain() {
        if (!audioCtx) return;
        // Disconnect old nodes
        if (hpNode) try { hpNode.disconnect(); } catch(e) {}
        if (lpNode) try { lpNode.disconnect(); } catch(e) {}
        if (gainNode) try { gainNode.disconnect(); } catch(e) {}

        gainNode = audioCtx.createGain();
        gainNode.gain.value = Math.pow(10, filters.gain / 20);

        hpNode = audioCtx.createBiquadFilter();
        hpNode.type = 'highpass';
        hpNode.frequency.value = filters.highpass || 0;

        lpNode = audioCtx.createBiquadFilter();
        lpNode.type = 'lowpass';
        lpNode.frequency.value = filters.lowpass || audioCtx.sampleRate / 2;

        // Chain: source -> hp -> lp -> gain -> destination
        if (sourceNode) {
          sourceNode.disconnect();
          sourceNode.connect(hpNode);
        }
        hpNode.connect(lpNode);
        lpNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      }

      function togglePlay() {
        if (isPlaying.value) {
          stopPlay();
        } else {
          startPlay();
        }
      }

      function startPlay() {
        if (!audioBuf) return;
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuf;
        sourceNode.loop = loopActive.value;
        if (loopActive.value && loopStart.value != null && loopEnd.value != null) {
          sourceNode.loopStart = loopStart.value * audioBuf.duration;
          sourceNode.loopEnd = loopEnd.value * audioBuf.duration;
        }
        buildFilterChain();
        sourceNode.connect(hpNode);

        let offset = pausedAt;
        if (loopActive.value && loopStart.value != null) {
          const ls = loopStart.value * audioBuf.duration;
          const le = loopEnd.value * audioBuf.duration;
          if (offset < ls || offset >= le) offset = ls;
        }
        sourceNode.start(0, offset);
        startedAt = audioCtx.currentTime - offset;
        isPlaying.value = true;

        sourceNode.onended = () => {
          if (isPlaying.value) {
            isPlaying.value = false;
            pausedAt = 0;
            progress.value = 0;
            currentTime.value = '0:00';
            cancelAnimationFrame(rafId);
          }
        };

        updateProgress();
      }

      function stopPlay() {
        if (sourceNode) {
          try { sourceNode.stop(); } catch(e) {}
          sourceNode = null;
        }
        if (audioCtx) {
          pausedAt = audioCtx.currentTime - startedAt;
        }
        isPlaying.value = false;
        cancelAnimationFrame(rafId);
      }

      function updateProgress() {
        if (!isPlaying.value || !audioCtx || !audioBuf) return;
        const elapsed = audioCtx.currentTime - startedAt;
        const dur = audioBuf.duration;
        progress.value = Math.min(100, (elapsed / dur) * 100);
        currentTime.value = fmtSec(elapsed);
        rafId = requestAnimationFrame(updateProgress);
      }

      function seek(e) {
        if (!audioBuf) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekTime = pct * audioBuf.duration;
        const wasPlaying = isPlaying.value;
        if (wasPlaying) {
          try { sourceNode.stop(); } catch(e2) {}
          sourceNode = null;
          isPlaying.value = false;
          cancelAnimationFrame(rafId);
        }
        pausedAt = seekTime;
        progress.value = pct * 100;
        currentTime.value = fmtSec(seekTime);
        if (wasPlaying) startPlay();
      }

      function setFilter(key, val) {
        filters[key] = val;
        if (isPlaying.value && audioCtx) {
          if (key === 'gain' && gainNode) {
            gainNode.gain.value = Math.pow(10, val / 20);
          } else if (key === 'highpass' && hpNode) {
            hpNode.frequency.value = val || 0;
          } else if (key === 'lowpass' && lpNode) {
            lpNode.frequency.value = val || audioCtx.sampleRate / 2;
          }
        }
      }

      // Loop selection via drag on canvas
      function onCanvasMousedown(e) {
        if (!audioBuf) return;
        const rect = e.currentTarget.getBoundingClientRect();
        _dragStart = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        _dragging = true;
        loopStart.value = _dragStart;
        loopEnd.value = _dragStart;
        loopActive.value = false;
      }

      function onCanvasMousemove(e) {
        if (!_dragging || !audioBuf) return;
        const rect = canvas.value.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        loopStart.value = Math.min(_dragStart, pos);
        loopEnd.value = Math.max(_dragStart, pos);
      }

      function onCanvasMouseup(e) {
        if (!_dragging) return;
        _dragging = false;
        if (loopEnd.value - loopStart.value < 0.02) {
          // Too small = click, treat as seek
          loopStart.value = null; loopEnd.value = null; loopActive.value = false;
          seek(e);
          return;
        }
        loopActive.value = true;
        // Restart playback in loop
        const wasPlaying = isPlaying.value;
        if (wasPlaying) stopPlay();
        pausedAt = loopStart.value * audioBuf.duration;
        if (wasPlaying) startPlay();
      }

      function clearLoop() {
        loopStart.value = null; loopEnd.value = null; loopActive.value = false;
        if (isPlaying.value && sourceNode) {
          sourceNode.loop = false;
        }
      }

      function close() {
      if (_spectroFocusTrap) { _spectroFocusTrap(); _spectroFocusTrap = null; }
        cleanup();
        closeSpectroModal();
      }

      function cleanup() {
        if (sourceNode) { try { sourceNode.stop(); } catch(e) {} sourceNode = null; }
        if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().catch(() => {}); }
        audioCtx = null; audioBuf = null; pcmData = null;
        isPlaying.value = false;
        progress.value = 0;
        currentTime.value = '0:00';
        duration.value = '0:00';
        pausedAt = 0;
        filters.gain = 0; filters.highpass = 0; filters.lowpass = 0;
        loopStart.value = null; loopEnd.value = null; loopActive.value = false;
        cancelAnimationFrame(rafId);
      }

      function onKeydown(e) {
        if (!modal.open) return;
        if (e.key === 'Escape') { close(); e.preventDefault(); }
        if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          togglePlay(); e.preventDefault();
        }
      }

      // Watch modal open state
      watch(() => modal.open, (val) => {
        if (val) {
          pausedAt = 0;
          nextTick(() => { loadAudio(); });
          document.addEventListener('keydown', onKeydown);
        } else {
          cleanup();
          document.removeEventListener('keydown', onKeydown);
        }
      });

      onUnmounted(() => {
        cleanup();
        document.removeEventListener('keydown', onKeydown);
      });

      return {
        modal, loading, isPlaying, progress, currentTime, duration,
        filters, gainOpts, hpOpts, lpOpts,
        canvas, audioUrl, downloadName,
        loopStart, loopEnd, loopActive,
        togglePlay, seek, setFilter, close, t,
        onCanvasMousedown, onCanvasMousemove, onCanvasMouseup, clearLoop
      };
    },
    template: `
<div v-if="modal.open" class="spectro-modal-overlay" @click.self="close" @keydown.escape="close" role="dialog" aria-modal="true" :aria-label="modal.speciesName">
  <div class="spectro-modal">
    <div class="spectro-modal-header">
      <div>
        <div class="spectro-modal-species">{{modal.speciesName}}</div>
        <div class="spectro-modal-sci">{{modal.sciName}}</div>
        <div class="spectro-modal-meta">
          <span v-if="modal.confidence" class="conf-badge" :class="modal.confidence>=0.8?'conf-high':'conf-mid'">
            {{Math.round(modal.confidence*100)}}%
          </span>
          <span v-if="modal.date">{{modal.date}}</span>
          <span v-if="modal.time">{{modal.time}}</span>
        </div>
      </div>
      <button class="spectro-modal-close" @click="close" aria-label="Close">&times;</button>
    </div>
    <div class="spectro-modal-canvas-wrap" style="position:relative;user-select:none;"
         @mousedown="onCanvasMousedown" @mousemove="onCanvasMousemove" @mouseup="onCanvasMouseup">
      <canvas ref="canvas" :width="800" :height="200"></canvas>
      <div v-if="loading" class="spectro-modal-loading">Loading...</div>
      <div v-if="isPlaying" class="spectro-cursor" :style="{left: progress+'%'}"></div>
      <div v-if="loopStart != null && loopEnd != null && loopEnd > loopStart"
           class="spectro-loop-zone"
           :style="{left: (loopStart*100)+'%', width: ((loopEnd-loopStart)*100)+'%'}"></div>
      <div class="spectro-freq-labels">
        <span>12kHz</span><span>9</span><span>6</span><span>3</span><span>0</span>
      </div>
    </div>
    <div class="spectro-modal-controls">
      <button class="play-big" :class="{playing: isPlaying}" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'">
        {{isPlaying ? '\u23F9' : '\u25B6'}}
      </button>
      <div class="audio-progress-wrap">
        <div class="audio-progress-bar" @click="seek">
          <div class="audio-progress-fill" :style="{width: progress+'%'}"></div>
        </div>
        <div class="audio-time">{{currentTime}} / {{duration}}</div>
      </div>
      <button v-if="loopActive" class="spectro-loop-btn" @click="clearLoop" title="Clear loop">🔁 ✕</button>
      <a :href="audioUrl" :download="downloadName" class="spectro-modal-dl" title="Download">\u2B07</a>
    </div>
    <div class="spectro-modal-filters">
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel">Gain (dB)</span>
        <div class="stb-pills">
          <button v-for="g in gainOpts" :key="g" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.gain===g}"
                  @click="setFilter('gain',g)">{{g===0?'Off':'+'+g}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel">{{t('af_highpass')}}</span>
        <div class="stb-pills">
          <button v-for="h in hpOpts" :key="h" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.highpass===h}"
                  @click="setFilter('highpass',h)">{{h===0?'Off':h>=1000?(h/1000)+'k':h}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel">{{t('af_lowpass')}}</span>
        <div class="stb-pills">
          <button v-for="l in lpOpts" :key="l" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.lowpass===l}"
                  @click="setFilter('lowpass',l)">{{l===0?'Off':l>=1000?(l/1000)+'k':l}}</button>
        </div>
      </div>
    </div>
  </div>
</div>`
  };

  // ── Filter UI components ──────────────────────────────────────────────────

  const FilterPeriod = {
    props: {
      period:       { type: String, default: '' },
      quickButtons: { type: Array,  default: () => [] },
      dateFrom:     { type: String, default: '' },
      dateTo:       { type: String, default: '' },
    },
    emits: ['set-period', 'set-custom'],
    setup(props, { emit }) {
      const { t } = useI18n();
      return { t, props, emit };
    },
    template: `
<div class="bf-period">
  <div class="bf-period-btns">
    <button v-for="b in quickButtons" :key="b.key"
            class="bf-period-btn" :class="{active: b.active}"
            @click="$emit('set-period', b.key)">{{b.label}}</button>
  </div>
  <div v-if="period==='custom'" class="bf-period-custom">
    <input type="date" class="bf-date-input" :value="dateFrom"
           @change="$emit('set-custom', $event.target.value, dateTo)">
    <span class="bf-date-sep">→</span>
    <input type="date" class="bf-date-input" :value="dateTo"
           @change="$emit('set-custom', dateFrom, $event.target.value)">
  </div>
</div>`
  };

  const FilterConfidence = {
    props: {
      confidence:  { type: Number, default: 0.7 },
      confEditing: { type: Boolean, default: false },
      confEditVal: { type: Number, default: 70 },
    },
    emits: ['update:confidence', 'start-edit', 'commit-edit', 'update:confEditVal'],
    setup(props, { emit }) {
      const { t } = useI18n();
      function onSlider(e) { emit('update:confidence', parseFloat(e.target.value)); }
      return { t, onSlider };
    },
    template: `
<div class="bf-confidence">
  <div class="bf-conf-row">
    <input type="range" class="bf-conf-slider" min="0" max="1" step="0.05"
           :value="confidence" @input="onSlider($event)"
           :aria-label="t('avg_confidence')">
    <span v-if="!confEditing" class="bf-conf-pct" @click="$emit('start-edit')"
          :title="t('click_to_edit')||'Click to edit'">{{Math.round(confidence*100)}}%</span>
    <input v-else type="number" class="bf-conf-edit" min="0" max="100"
           :value="confEditVal"
           @input="$emit('update:confEditVal', parseInt($event.target.value)||0)"
           @keydown.enter="$emit('commit-edit')"
           @blur="$emit('commit-edit')"
           ref="confInput">
  </div>
</div>`
  };

  const FilterSpecies = {
    props: {
      source:         { type: Array,   default: () => [] },
      selectedSpecies:{ type: Array,   default: () => [] },
      filteredList:   { type: Array,   default: () => [] },
      speciesSearch:  { type: String,  default: '' },
      allSelected:    { type: Boolean, default: false },
      spName:         { type: Function, default: (n) => n },
    },
    emits: ['toggle-species', 'toggle-all', 'update:speciesSearch'],
    setup(props, { emit }) {
      const { t } = useI18n();
      return { t };
    },
    template: `
<div class="bf-species">
  <input class="bf-sp-search" type="search"
         :placeholder="'🔍 '+(t('filter_species_ph')||'Filter species…')"
         :value="speciesSearch"
         @input="$emit('update:speciesSearch', $event.target.value)">
  <div class="bf-sp-actions">
    <button class="bf-sp-toggle-btn" :class="{active: allSelected}"
            @click="$emit('toggle-all')">
      {{allSelected ? t('deselect_all') : t('select_all')+' ('+source.length+')'}}
    </button>
  </div>
  <div class="bf-sp-list">
    <div v-for="sp in filteredList" :key="sp.name"
         class="bf-sp-item" :class="{selected: selectedSpecies.includes(sp.name)}"
         @click="$emit('toggle-species', sp.name)">
      <div class="bf-sp-check">{{selectedSpecies.includes(sp.name)?'✓':''}}</div>
      <span class="bf-sp-name" :title="sp.name">{{spName(sp.name, sp.sci)}}</span>
      <span class="bf-sp-count">{{sp.count}}</span>
    </div>
  </div>
</div>`
  };

  // ── Swipe directive ──────────────────────────────────────────────────────
  // Usage: v-swipe="{ left: fn, right: fn }"
  const vSwipe = {
    mounted(el, binding) {
      let sx = 0, sy = 0;
      el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
      el.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
        const fns = binding.value || {};
        if (dx < 0 && fns.left) fns.left();
        if (dx > 0 && fns.right) fns.right();
      }, { passive: true });
    }
  };

  // Enregistre les composants globaux sur une instance d'app Vue
  function registerComponents(app) {
    app.directive('swipe', vSwipe);
    app.component('birdash-shell', PibirdShell);
    app.component('bird-img', BirdImg);
    app.component('spectro-modal', SpectroModal);
    app.component('filter-period', FilterPeriod);
    app.component('filter-confidence', FilterConfidence);
    app.component('filter-species', FilterSpecies);
    return app;
  }

  // ── Export global ─────────────────────────────────────────────────────────
  window.BIRDASH = {
    // Vue composables
    useI18n, useTheme, useNav, useChart, useAudio, useFavorites, useSpeciesNames, useToast, updateSiteIdentity, exportChart,
    // Filter composables
    useFilterPeriod, useFilterConfidence, useFilterSpecies, buildWhereClause,
    // Vue components
    PibirdShell, registerComponents, MODEL_LABELS, vSwipe,
    // Wrapper with reactive lang injection (calls BIRDASH_UTILS under the hood)
    buildSpeciesLinks,
    // Re-exports from BIRDASH_UTILS for backward compatibility
    // (pages destructure these from BIRDASH, so they must remain available)
    birdQuery:        U.birdQuery,
    escHtml:          U.escHtml,
    safeHtml:         U.safeHtml,
    authHeaders:      U.authHeaders,
    fmtDate:          U.fmtDate,
    fmtTime:          U.fmtTime,
    fmtConf:          U.fmtConf,
    localDateStr:     U.localDateStr,
    daysAgo:          U.daysAgo,
    freshnessLabel:   U.freshnessLabel,
    buildAudioUrl:    U.buildAudioUrl,
    fetchSpeciesImage:U.fetchSpeciesImage,
    photoUrl: U.photoUrl,
    getUrlParam:      U.getUrlParam,
    navigateTo:       U.navigateTo,
    chartDefaults:    U.chartDefaults,
    spinnerHTML:      U.spinnerHTML,
    shortModel:       U.shortModel,
    quickPlaySpecies: U.quickPlaySpecies,
    // DSP
    fftInPlace:          U.fftInPlace,
    buildColorLUT:       U.buildColorLUT,
    COLOR_LUT:           U.COLOR_LUT,
    renderSpectrogram:   U.renderSpectrogram,
    drawSpectrogramFromPcm: U.drawSpectrogramFromPcm,
    fetchAndDecodeAudio: U.fetchAndDecodeAudio,
    highpassIIR:         U.highpassIIR,
    spectralSubtract:    U.spectralSubtract,
    cleanAudioPipeline:  U.cleanAudioPipeline,
    encodeWav:           U.encodeWav,
    // Spectrogram modal
    openSpectroModal: openSpectroModal,
    closeSpectroModal: closeSpectroModal,
    _spectroModal: _spectroModal,
    // Direct access to translations
    TRANSLATIONS: _TRANSLATIONS,
  };

})(Vue, BIRD_CONFIG, window.BIRDASH_UTILS);
