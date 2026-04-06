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
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW] registration failed:', e.message));
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

  // ── i18n: French inline, other languages loaded async from /i18n/*.json ──
  const _TRANSLATIONS = {
    fr: {
  "_meta": {
    "lang": "fr",
    "label": "Français",
    "flag": "🇫🇷"
  },
  "nav_sec_realtime": "En direct",
  "nav_sec_history": "Historique",
  "nav_sec_species": "Espèces",
  "nav_sec_insights": "Analyses",
    "dash_title": "Bird Flow",
  "dash_baseline": "Ecoute, analyse et valide l'activite aviaire en temps reel.",
  "dash_dual_consensus": "Consensus dual",
  "dash_single_model": "Modele unique",
  "dash_accepted": "Accepte",
  "dash_review": "A valider",
  "dash_stage_listen": "Ecoute",
  "dash_stage_record": "Enreg.",
  "dash_stage_analyze": "Analyse",
  "dash_stage_store": "Stockage",
  "dash_events": "evenements",
  "dash_key_events": "Evenements cles",
  "dash_recent_species": "Especes du jour",
  "dash_sys_title": "Etat du systeme",
  "dash_sys_model": "Modele principal",
  "dash_sys_secondary": "Modele secondaire",
  "dash_sys_sensitivity": "Sensibilite",
  "dash_sys_lag": "Retard",
  "dash_sys_backlog": "File attente",
  "dash_sys_rec_len": "Duree enreg.",
  "dash_listening": "Écoute active",
  "dash_mic_active": "Micro actif",
  "dash_mic_idle": "En attente",
  "dash_pipeline": "Pipeline",
  "dash_backlog": "fichiers en attente",
  "dash_lag": "retard",
  "dash_recording": "durée enregistrement",
  "dash_dual_ai": "Double IA",
  "dash_confidence_thresh": "Seuil de confiance",
  "dash_latest": "Dernière détection",
  "dash_no_detection": "Aucune détection récente",
  "dash_kpi_detections": "Détections aujourd'hui",
  "dash_kpi_species": "Espèces uniques",
  "dash_kpi_review": "À valider",
  "dash_kpi_health": "Santé système",
  "dash_activity": "Activité en direct",
  "dash_waiting": "En attente de logs…",
  "dash_health_ok": "OK",
  "dash_health_delayed": "Retard",
  "dash_health_catching": "Rattrapage",
  "nav_dashboard": "Bird Flow",
  "nav_sec_home": "Accueil",
  "nav_sec_indicators": "Indicateurs",
  "nav_sec_system": "Station",
  "nav_sec_observe": "Observer",
  "nav_sec_explore": "Explorer",
  "nav_overview": "Accueil",
  "nav_today": "Aujourd'hui",
  "nav_recent": "Activité",
  "nav_review": "À valider",
  "nav_detections": "Détections",
  "nav_species": "Espèces",
  "nav_biodiversity": "Biodiversité",
  "nav_rarities": "Rarités",
  "nav_stats": "Statistiques",
  "nav_system": "Monitoring",
  "nav_analyses": "Analyses",
  "nav_models": "Modèles",
  "nav_terminal": "Terminal",
  "nav_spectrogram": "Live",
  "nav_recordings": "Enregistrements",
  "nav_gallery": "Meilleures captures",
  "nav_settings": "Configuration",
  "nav_timeline": "Chronologie",
  "nav_calendar": "Calendrier",
  "nav_log": "Log live",
  "nav_more": "Plus",
  "log_live": "En direct",
  "log_paused": "En pause",
  "log_disconnected": "Déconnecté",
  "log_pause": "Pause",
  "log_resume": "Reprendre",
  "log_clear": "Effacer",
  "log_errors": "Erreurs",
  "log_lines": "Lignes",
  "log_all": "Tous",
  "log_waiting": "En attente de logs...",
  "gallery_title": "Meilleures captures",
  "gallery_tab_best": "Meilleures",
  "gallery_tab_library": "Bibliothèque audio",
  "gallery_delete": "Supprimer",
  "gallery_delete_confirm": "Supprimer cette détection et ses fichiers ?",
  "top_detections_per_species": "meilleures détections",
  "set_location": "Localisation",
  "set_site_name": "Nom du site",
  "set_site_brand": "Nom principal (header)",
  "set_latitude": "Latitude",
  "set_longitude": "Longitude",
  "set_model": "Modèle de détection",
  "set_model_choice": "Modèle IA",
  "set_species_freq_thresh": "Seuil fréquence espèces",
  "set_analysis": "Analyse",
  "set_params": "Paramètres",
  "set_shared_params": "Paramètres communs",
  "set_confidence": "Confiance",
  "set_birdnet_conf": "Confiance BirdNET",
  "set_perch_conf": "Confiance Perch",
  "set_perch_margin": "Marge Perch (top1-top2)",
  "set_sensitivity": "Sensibilité",
  "set_language": "Langue des espèces",
  "set_notifications": "Notifications",
  "set_notify_each": "Notifier chaque détection",
  "set_notify_new_species": "Notifier nouvelle espèce (jamais vue)",
  "set_notify_new_daily": "Notifier première espèce du jour",
  "set_weekly_report": "Rapport hebdomadaire",
  "set_notif_urls": "URLs de notification (Apprise)",
  "set_notif_urls_help": "Une URL par ligne. Exemples :",
  "set_notif_title": "Titre de la notification",
  "set_notif_body": "Corps du message",
  "set_notif_body_help": "Variables : $comname, $sciname, $confidence, $date, $time",
  "set_notif_test": "Tester",
  "set_notif_testing": "Envoi en cours…",
  "set_notif_test_ok": "Notification envoyée !",
  "set_notif_test_fail": "Échec : {error}",
  "set_notif_cooldown": "Délai min. entre notifications (secondes)",
  "set_notif_no_urls": "Aucune URL configurée — les notifications ne seront pas envoyées.",
  "set_alerts_title": "Alertes système",
  "set_alerts_desc": "Recevez une notification quand un seuil critique est dépassé.",
  "set_notif_events_title": "Événements notifiés",
  "set_notif_events_desc": "Cochez les événements pour lesquels vous souhaitez recevoir une notification.",
  "set_notif_cat_birds": "Détections d'espèces",
  "set_notif_cat_system": "Surveillance système",
  "set_alert_temp_warn": "Température alerte",
  "set_alert_temp_crit": "Température critique",
  "set_alert_disk_warn": "Espace disque alerte",
  "set_alert_ram_warn": "Mémoire RAM alerte",
  "set_alert_backlog": "Backlog analyse",
  "set_alert_no_det": "Silence détections",
  "set_alert_svc_down": "Alerter si un service critique tombe",
  "set_notif_cat_bird_smart": "Alertes oiseaux intelligentes",
  "set_alert_influx": "Afflux inhabituel (>3x la moyenne)",
  "set_alert_missing": "Espèce commune absente (après midi)",
  "set_alert_rare_visitor": "Visiteur rare détecté",
  "set_tab_detection": "Détection",
  "set_tab_audio": "Audio",
  "set_tab_notif": "Notifications",
  "set_tab_station": "Station",
  "set_tab_services": "Services",
  "set_tab_species": "Espèces",
  "set_tab_system": "Système",
  "set_tab_backup": "Sauvegarde",
  "set_tab_database": "Base de données",
  "set_tab_terminal": "Terminal",
  "bkp_init": "Initialisation",
  "bkp_db": "Base de données",
  "bkp_config": "Configuration",
  "bkp_projects": "Projets",
  "bkp_audio": "BirdSongs",
  "bkp_upload": "Upload",
  "bkp_mount": "Montage",
  "bkp_done": "Terminé",
  "bkp_stopped_by_user": "Arrêté par l'utilisateur",
  "bkp_starting": "Démarrage…",
  "bkp_next_run": "Prochain",
  "bkp_no_schedule": "Aucune planification — mode manuel",
  "bkp_history": "Historique",
  "share": "Partager",
  "analyze_deep": "Analyse approfondie",
  "fav_add": "Ajouter aux favoris",
  "fav_remove": "Retirer des favoris",
  "nav_favorites": "Favoris",
  "fav_total": "Total favoris",
  "fav_active_today": "Actifs aujourd'hui",
  "fav_total_dets": "Détections totales",
  "fav_today_dets": "Détections du jour",
  "fav_added": "Ajouté le",
  "fav_last_seen": "Dernière obs.",
  "fav_first_seen": "Première obs.",
  "fav_avg_conf": "Confiance moy.",
  "fav_empty": "Aucun favori — ajoutez des espèces avec ☆",
  "fav_sort_name": "Nom",
  "fav_sort_recent": "Récent",
  "fav_sort_count": "Détections",
  "photo_ban": "Bannir",
  "photo_set_preferred": "Définir par défaut",
  "photo_banned": "Photo bannie",
  "photo_reset": "Réinitialiser",
  "fav_only": "Favoris uniquement",
  "phenology_calendar": "Calendrier phénologique",
  "notifications": "Notifications",
  "wn_empty": "Rien de nouveau",
  "set_save": "Enregistrer",
  "set_saved": "Configuration enregistrée avec succès",
  "set_defaults": "Défaut",
  "set_defaults_confirm": "Remettre tous les paramètres de détection à leurs valeurs par défaut ?",
  "set_defaults_applied": "Valeurs par défaut appliquées — cliquez Enregistrer pour confirmer",
  "set_recording": "Enregistrement audio",
  "set_overlap": "Chevauchement (s)",
  "set_rec_length": "Durée enregistrement (s)",
  "set_extraction_length": "Durée extraction (s)",
  "set_channels": "Canaux micro",
  "set_audio_format": "Format audio",
  "set_disk_mgmt": "Gestion du disque",
  "set_full_disk": "Disque plein",
  "set_purge_threshold": "Seuil de purge (%)",
  "set_max_files": "Max fichiers/espèce (0=illimité)",
  "set_privacy": "Confidentialité",
  "set_privacy_threshold": "Filtre voix humaine",
  "set_services": "Services BirdNET",
  "set_restart": "Redémarrer",
  "set_service_active": "Actif",
  "set_service_inactive": "Inactif",
  "set_species_lists": "Listes d'espèces",
  "set_include_list": "Liste d'inclusion",
  "set_exclude_list": "Liste d'exclusion",
  "set_whitelist": "Passe-droit (bypass seuil)",
  "set_birdweather": "BirdWeather",
  "set_image_provider": "Source des images",
  "set_rtsp": "Flux RTSP",
  "set_rtsp_stream": "URL du flux RTSP",
  "set_model_desc_birdnet": "BirdNET V2.4 — 6500 espèces, optimisé Pi (recommandé)",
  "set_model_desc_mdata": "BirdNET V2.4 + filtre géographique — filtre les espèces par localisation et semaine",
  "set_model_desc_mdata_v2": "BirdNET V2.4 + filtre géo V2 — filtre amélioré par localisation et semaine",
  "set_model_desc_v1": "BirdNET V1 — ancien modèle, moins précis (legacy)",
  "set_model_desc_perch": "Google Perch V2 — 10 340 oiseaux parmi 15K espèces totales",
  "set_model_desc_perch_fp16": "Google — 10 340 oiseaux, ~384 ms sur Pi 5. Qualité quasi parfaite vs original (top-1 100%, top-5 99%).",
  "set_model_desc_perch_dynint8": "Google — 10 340 oiseaux, ~299 ms sur Pi 5, ~700 ms sur Pi 4. 4× plus léger (top-1 93%).",
  "set_model_desc_perch_original": "Google — 10 340 oiseaux, référence non modifiée. Le plus précis mais le plus lourd (~435 ms sur Pi 5).",
  "set_model_desc_go": "BirdNET-Go — variante expérimentale",
  "set_restart_confirm": "Redémarrer les services pour appliquer ?",
  "set_save_restart": "Enregistrer et redémarrer",
  "today": "Aujourd'hui",
  "this_week": "Cette semaine",
  "this_month": "Ce mois",
  "all_time": "Total",
  "detections": "Détections",
  "species": "Espèces",
  "avg_confidence": "Confiance moy.",
  "last_detection": "Dernière détection",
  "top_species": "Top espèces",
  "activity_7d": "Activité 7 jours",
  "activity_today": "Activité aujourd'hui",
  "last_hour": "Dernière heure",
  "new_species": "Nouvelles espèces",
  "rare_today": "Espèces rares aujourd'hui",
  "recent_detections": "Détections récentes",
  "today_log": "Journal du jour",
  "no_data": "Aucune donnée",
  "loading": "Chargement…",
  "error": "Erreur",
  "network_error": "Erreur réseau",
  "date": "Date",
  "time": "Heure",
  "species_name": "Espèce",
  "scientific_name": "Nom scientifique",
  "confidence": "Confiance",
  "audio": "Audio",
  "play": "Écouter",
  "filter_species": "Filtrer par espèce",
  "filter_order": "Ordre taxonomique",
  "filter_family": "Famille",
  "all_orders": "Tous les ordres",
  "all_families": "Toutes les familles",
  "filter_date_from": "Du",
  "filter_date_to": "Au",
  "filter_confidence": "Confiance min.",
  "all_species": "Toutes espèces",
  "apply_filter": "Appliquer",
  "reset_filter": "Réinitialiser",
  "default_btn": "Défaut",
  "prev_page": "← Précédent",
  "next_page": "Suivant →",
  "page": "Page",
  "of": "sur",
  "results": "résultats",
  "species_detail": "Fiche espèce",
  "first_detection": "Première détection",
  "last_seen": "Dernière fois",
  "total_detections": "Total détections",
  "max_confidence": "Confiance max.",
  "activity_by_hour": "Activité par heure",
  "monthly_presence": "Présence mensuelle",
  "external_links": "Liens externes",
  "listen_on": "Écouter sur",
  "observe_on": "Observer sur",
  "species_x_month": "Espèces par mois",
  "richness_per_day": "Richesse journalière",
  "heatmap_hour_day": "Activité heure × jour",
  "kb_shortcuts_hint": "Espace = lecture, ← → = navigation",
  "db_tables": "Tables",
  "db_refresh": "Rafraîchir",
  "db_schema": "Schema",
  "db_query": "Requête SQL",
  "db_exec": "Exécuter",
  "db_executing": "Exécution...",
  "db_readonly": "Lecture seule — SELECT, PRAGMA, WITH uniquement",
  "db_rows": "{n} ligne(s)",
  "db_col": "Colonne",
  "db_type": "Type",
  "db_new": "Nouveau",
  "dual_model": "Dual-model",
  "dual_desc": "Analyse chaque fichier avec deux modèles en parallèle",
  "secondary_model": "Modèle secondaire",
  "dual_active": "{model} actif",
  "dual_wait": "Le modèle secondaire sera chargé au prochain cycle (~5 min).",
  "dual_status_active": "actif",
  "dual_status_primary": "Primaire",
  "dual_status_secondary": "Secondaire",
  "audio_profile": "Profil actif",
  "audio_strategy": "Stratégie multi-canaux",
  "audio_strategy_2ch": "Disponible uniquement avec 2 microphones.",
  "audio_save": "Sauvegarder",
  "audio_refresh": "Rafraîchir",
  "audio_no_device": "Aucun périphérique audio détecté.",
  "audio_wiring": "Câblage microphones",
  "audio_sr_note": "Sample rate de sortie : 32 000 Hz (imposé par Perch V2, non modifiable)",
  "cal_title": "Calibration inter-canaux",
  "cal_need_2ch": "La calibration nécessite 2 microphones.",
  "cal_expired": "Calibration expirée (> 7 jours). Recalibration recommandée.",
  "cal_not_done": "Les deux canaux ne sont pas calibrés.",
  "cal_instructions": "Placez les deux microphones côte à côte (< 5 cm), même direction. La capture dure 10 secondes.",
  "cal_start": "Démarrer la calibration",
  "cal_capturing": "Capture en cours... (10 secondes)",
  "cal_apply": "Appliquer et sauvegarder",
  "cal_retry": "Recommencer",
  "notif_channel": "Canal de notification",
  "notif_on": "Notifications actives",
  "notif_off": "Notifications désactivées",
  "notif_save": "Sauvegarder",
  "notif_test": "Tester",
  "notif_rare": "Espèce rare",
  "notif_rare_desc": "Jamais vue ou moins de N détections au total",
  "notif_season": "Première de saison",
  "notif_season_desc": "Pas vue depuis N jours",
  "notif_season_days_label": "Absence depuis",
  "notif_new": "Nouvelle espèce — Jamais détectée",
  "notif_daily": "Première du jour",
  "notif_daily_warn": "bruyant : ~50 notifs/jour",
  "notif_each": "Chaque détection",
  "notif_each_warn": "très bruyant : ~1000+ notifs/jour",
  "notif_favorites": "Favoris",
  "notif_favorites_desc": "Notification quand un favori est détecté (1× par jour par espèce)",
  "notif_report": "Rapport hebdomadaire",
  "notif_bird_alerts": "Alertes oiseaux",
  "notif_sys_alerts": "Alertes système",
  "unit_days": "jours",
  "audio_overlap": "Chevauchement des fenêtres",
  "review_suspects": "{n} suspectes",
  "review_total": "total",
  "review_selected": "{n} sélectionnées",
  "review_select_all": "Tout sélectionner",
  "review_deselect": "Tout désélectionner",
  "review_confirm": "Confirmer",
  "review_reject": "Rejeter",
  "review_reject_rule": "Rejeter par règle",
  "review_confirm_q": "Confirmer {n} détections ?",
  "review_reject_q": "Rejeter {n} détections ?",
  "review_reject_rule_q": "Rejeter {n} détections \"{rule}\" ?",
  "review_none": "Aucune détection suspecte pour cette période.",
  "review_showing": "affichées",
  "review_show_more": "Afficher plus",
  "review_confirmed_msg": "Confirmé",
  "review_rejected_msg": "Rejeté",
  "review_doubtful_msg": "Douteux",
  "review_action_error": "Erreur de validation",
  "review_detections": "détections",
  "review_purge": "Purger les rejetées",
  "review_purge_title": "Suppression des détections rejetées",
  "review_purge_warning": "Les détections suivantes seront supprimées de la base de données et les fichiers audio associés seront effacés. Cette action est irréversible.",
  "review_purge_confirm": "Supprimer définitivement",
  "review_delete_done": "Suppression terminée",
  "models_detections": "détections",
  "models_species": "espèces",
  "models_avg_conf": "conf. moy.",
  "models_daily": "Détections par jour et par modèle",
  "models_exclusive": "Espèces exclusives",
  "models_overlap": "Espèces détectées par les deux modèles",
  "models_ratio": "Ratio",
  "models_none": "Aucune espèce exclusive",
  "species_tab": "Inclusion / Exclusion d'espèces",
  "species_desc": "Contrôle quelles espèces sont détectées. Un nom scientifique par ligne.",
  "species_include_desc": "Si remplie, seules ces espèces seront détectées.",
  "species_exclude_desc": "Ces espèces seront ignorées.",
  "fp_preview": "Prévisualiser",
  "fp_recording": "Enregistrement (3s)...",
  "fp_title": "Avant / Après filtres",
  "fp_before": "Avant (signal brut)",
  "fp_after": "Après (filtres appliqués)",
  "fp_hint": "Spectrogramme généré à partir de 3 secondes du micro. Relancez pour actualiser.",
  "audio_1ch": "1 microphone (canal 0)",
  "audio_2ch": "2 microphones (canaux 0+1)",
  "audio_highpass": "Filtre passe-haut",
  "audio_lowpass": "Filtre passe-bas",
  "audio_lp_birds": "Oiseaux",
  "audio_lp_wide": "Large",
  "audio_lp_full": "Complet",
  "audio_denoise": "Réduction de bruit spectrale",
  "audio_denoise_desc": "Atténue le bruit de fond constant (vent, trafic, insectes) par masquage spectral. Nécessite scipy + noisereduce.",
  "audio_denoise_light": "Léger",
  "audio_denoise_strong": "Fort",
  "audio_denoise_warn": "Un réglage élevé peut atténuer des chants faibles.",
  "audio_rms": "Normalisation RMS",
  "audio_levels": "Niveaux d'entrée en temps réel",
  "audio_test": "Test audio (5 secondes)",
  "audio_test_btn": "Tester l'audio",
  "audio_duplicate": "Dupliquer",
  "audio_delete": "Supprimer",
  "audio_calm": "Calme",
  "audio_road": "Route",
  "audio_urban": "Urbain",
  "audio_cpu_warn": "Charge CPU élevée sur RPi5",
  "audio_threshold": "Seuil",
  "audio_max_det": "détections max au total",
  "audio_target": "Cible",
  "audio_enabled": "Activé",
  "audio_start": "Démarrer",
  "audio_stop": "Arrêter",
  "audio_click_start": "Cliquez sur Démarrer pour afficher les niveaux audio en temps réel.",
  "audio_detected": "Périphériques audio détectés",
  "audio_sub_device": "Périphérique",
  "audio_sub_profile": "Profil & Paramètres",
  "audio_sub_cal": "Calibration",
  "audio_sub_monitor": "Monitoring",
  "audio_last_cal": "Dernière calibration",
  "audio_ch0": "Canal 0 (CH0)",
  "audio_ch1": "Canal 1 (CH1)",
  "audio_gain_comp": "Gain compensatoire",
  "audio_sum": "Sommation",
  "audio_sum_desc": "Combine les deux signaux (gain SNR +3dB)",
  "audio_max": "Maximum",
  "audio_max_desc": "Retient le score le plus élevé (maximise le rappel)",
  "audio_vote": "Vote",
  "audio_vote_desc": "Exige la détection sur les deux canaux (réduit faux positifs)",
  "ag_title": "Normalisation adaptative",
  "ag_desc": "Ajuste le gain logiciel selon le bruit ambiant. Mode observateur : calcule sans appliquer.",
  "ag_enabled": "Activer",
  "ag_mode": "Mode",
  "ag_conservative": "Conservateur",
  "ag_balanced": "Équilibré",
  "ag_night": "Nuit",
  "ag_observer": "Observateur uniquement",
  "ag_apply": "Appliquer le gain",
  "ag_min": "Gain min",
  "ag_max": "Gain max",
  "ag_interval": "Intervalle",
  "ag_history": "Historique",
  "ag_target": "Plancher cible",
  "ag_clip_guard": "Protection clipping",
  "ag_hold": "Gel activité",
  "ag_state": "État actuel",
  "ag_noise_floor": "Plancher bruit",
  "ag_activity": "Activité",
  "ag_peak": "Crête",
  "ag_current_gain": "Gain actuel",
  "ag_recommended": "Gain recommandé",
  "ag_reason": "Raison",
  "ag_disabled": "Désactivé",
  "ag_stable": "Stable",
  "ag_step_up": "Montée",
  "ag_step_down": "Descente",
  "ag_clip": "Protection clipping",
  "ag_activity_hold": "Gel (activité)",
  "ag_observer_mode": "Observation",
  "ag_init": "Initialisation",
  "ag_not_enough": "Données insuffisantes",
  "ag_advanced": "Paramètres avancés",
  "ag_noise_pct": "Percentile bruit",
  "retention_days": "Rétention audio (jours)",
  "terminal_desc": "Bash — supporte Claude Code",
  "spectro_live": "Live Micro",
  "spectro_clips": "Clips détections",
  "audio_cleaning": "Nettoyage audio…",
  "audio_analyzing": "Analyse audio…",
  "audio_unavailable": "Fichier audio indisponible",
  "audio_not_found": "Fichier audio introuvable (404)",
  "audio_decode_error": "Erreur de décodage audio",
  "audio_no_file": "Pas de fichier audio enregistré",
  "audio_bad_name": "Nom de fichier non reconnu",
  "audio_clean_progress": "Nettoyage…",
  "audio_clean_done": "Nettoyé",
  "audio_clean_btn": "Nettoyer le son",
  "svc_engine": "Moteur de détection",
  "svc_recording": "Capture audio",
  "svc_web": "Serveur web",
  "svc_terminal": "Terminal web",
  "sys_tab_health": "Santé",
  "sys_tab_model": "Modèle",
  "sys_tab_data": "Données",
  "sys_tab_external": "Externe",
  "shannon_index": "Indice de Shannon",
  "shannon_evenness": "Équitabilité",
  "personal_notes": "Notes personnelles",
  "bio_taxonomy_orders": "Répartition par ordre",
  "bio_taxonomy_families": "Familles détectées",
  "rare_species": "Espèces rares",
  "rare_desc": "Espèces avec moins de {n} détections",
  "first_seen": "Vue la première fois",
  "detections_count": "Nb détections",
  "top_by_count": "Classement par détections",
  "top_by_confidence": "Classement par confiance",
  "confidence_distrib": "Distribution confiance",
  "activity_calendar": "Calendrier d'activité",
  "monthly_totals": "Totaux mensuels",
  "freq_range": "Plage de fréquence",
  "nav_weather": "Météo & Oiseaux",
  "weather_activity": "Météo & Activité",
  "weather_correlation": "Corrélation météo/activité",
  "weather_best": "Meilleures conditions : ~{temp}°C, ~{precip}mm pluie/jour",
  "weather_best_full": "Meilleures conditions : ~{temp}°C, ~{precip}mm pluie, vent ~{wind}km/h",
  "weather_forecast": "Prévision demain",
  "weather_trend": "activité prévue {pct}%",
  "weather_top_species": "Espèces par conditions météo",
  "temperature": "Température",
  "precipitation": "Précipitations",
  "wind": "Vent",
  "db_status": "État base de données",
  "db_size": "Taille DB",
  "db_total": "Total enregistrements",
  "db_first": "Première détection",
  "db_last": "Dernière détection",
  "service_status": "État du service",
  "api_ok": "API opérationnelle",
  "api_error": "API hors ligne",
  "data_freshness": "Fraîcheur données",
  "minutes_ago": "il y a {n} min",
  "hours_ago": "il y a {n}h",
  "days_ago": "il y a {n}j",
  "months_short": [
    "Jan",
    "Fév",
    "Mar",
    "Avr",
    "Mai",
    "Jun",
    "Jul",
    "Aoû",
    "Sep",
    "Oct",
    "Nov",
    "Déc"
  ],
  "months_long": [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre"
  ],
  "days_short": [
    "Lun",
    "Mar",
    "Mer",
    "Jeu",
    "Ven",
    "Sam",
    "Dim"
  ],
  "analyses_period": "Explorer pour la période {from} → {to}",
  "analyses_what_species": "Quelle espèce explorer ?",
  "analyses_loading_ph": "— chargement… —",
  "analyses_no_species": "— aucune espèce —",
  "analyses_topn_label": "Top",
  "analyses_topn_unit": "espèces",
  "analyses_topn_btn": "Sélectionner",
  "analyses_clear_btn": "✕ Tout désélectionner",
  "analyses_search_ph": "🔍  Filtrer les espèces…",
  "analyses_n_selected": "{n} espèce(s) sélectionnée(s)",
  "analyses_n_total": "{n} espèce(s) au total",
  "analyses_kpi_raw": "Détections brutes",
  "analyses_kpi_resampled": "Après rééchantillonnage",
  "analyses_kpi_conf": "Confiance moyenne",
  "analyses_kpi_days": "Jours détectée",
  "analyses_kpi_avg_day": "Moy. / jour",
  "analyses_polar_title": "Activité horaire · {species}",
  "analyses_series_title": "Détections dans le temps · {species}",
  "analyses_heatmap_title": "Heatmap journalière · {species}",
  "circadian_comparison": "Comparaison circadienne",
  "analyses_multi_polar": "Activité horaire · {species} (principale)",
  "analyses_multi_series": "Comparaison {n} espèces",
  "analyses_no_data_period": "Aucune donnée pour cette période.",
  "analyses_tooltip_det": "{n} détections · {pct}% de la journée",
  "analyses_resample_raw": "Brut",
  "analyses_resample_15": "15 min",
  "analyses_resample_1h": "Horaire",
  "analyses_resample_1d": "Journalier",
  "analyses_conf_label": "Confiance min.",
  "analyses_date_from": "Du",
  "analyses_date_to": "Au",
  "analyses_quick_7d": "7j",
  "analyses_quick_30d": "30j",
  "analyses_quick_90d": "90j",
  "analyses_quick_1y": "1 an",
  "analyses_quick_all": "Tout",
  "resolution": "Résolution",
  "analyses_date_range": "Plage de dates",
  "analyses_pct_of_day": "de la journée",
  "analyses_quarter_distrib": "Distribution par quart d'heure",
  "analyses_best_dets": "Meilleures détections",
  "analyses_no_det": "Aucune détection",
  "analyses_select_prompt": "Sélectionnez une ou plusieurs espèces pour explorer leurs données.",
  "analyses_last_60d": "Affichage des 60 derniers jours ({total} jours au total)",
  "analyses_peak_hour": "Heure de pointe",
  "narr_no_data": "Aucune donnée pour cette période.",
  "narr_period": "Sur la période {from} → {to},",
  "narr_habit_morning": "matinal",
  "narr_habit_midday": "actif en milieu de journée",
  "narr_habit_afternoon": "actif en fin d'après-midi",
  "narr_habit_night": "nocturne ou crépusculaire",
  "narr_habit_day": "actif dans la journée",
  "narr_is": "est",
  "narr_peak_at": "Son pic d'activité se situe à {time}, représentant {pct}% des détections.",
  "narr_activity_range": "L'activité démarre vers {start} et se termine vers {end}, soit environ {duration}.",
  "narr_duration": "{n}h d'activité",
  "narr_duration_short": "activité concentrée",
  "narr_second_peak": "Un second pic notable apparaît vers {time}.",
  "narr_night_pct": "{pct}% des détections se produisent entre 21h et 5h du matin.",
  "narr_total": "Total : {n} détections sur {h} heures actives.",
  "narr_multi_intro": "{n} espèces sélectionnées. Espèce principale : {species}.",
  "narr_multi_hint": "Le rose chart et la heatmap affichent les données de {species}. La série temporelle compare toutes les espèces.",
  "grp_mode_species": "Par espèce",
  "grp_mode_taxo": "Par groupe taxonomique",
  "grp_title_order": "Analyse de l'ordre {name}",
  "grp_title_family": "Analyse de la famille {name}",
  "grp_kpi_species": "Espèces dans le groupe",
  "grp_kpi_detections": "Détections totales",
  "grp_kpi_conf": "Confiance moyenne",
  "grp_kpi_days": "Jours actifs",
  "grp_kpi_avg_day": "Moy. / jour",
  "grp_polar_title": "Activité horaire · {name}",
  "grp_series_title": "Détections dans le temps · {name}",
  "grp_series_families": "Détections par famille · {name}",
  "grp_heatmap_title": "Heatmap journalière · {name}",
  "grp_breakdown_title": "Répartition par espèce",
  "grp_breakdown_species": "Espèce",
  "grp_breakdown_count": "Détections",
  "grp_breakdown_pct": "%",
  "grp_breakdown_conf": "Confiance",
  "grp_select_prompt": "Sélectionnez un ordre ou une famille pour analyser le groupe.",
  "grp_narr_period": "Sur la période {from} → {to}, le groupe <strong>{name}</strong> compte {species} espèces pour {total} détections.",
  "grp_narr_dominant": "L'espèce dominante est <strong>{species}</strong> avec {pct}% des détections.",
  "grp_narr_peak": "Le pic d'activité du groupe se situe à {time}.",
  "guild_filter": "Guilde écologique",
  "guild_all": "Toutes les guildes",
  "guild_raptors": "Rapaces",
  "guild_waterbirds": "Oiseaux d'eau",
  "guild_woodpeckers": "Pics",
  "guild_passerines_forest": "Passereaux forestiers",
  "guild_passerines_open": "Passereaux milieux ouverts",
  "guild_thrushes_chats": "Grives et gobemouches",
  "guild_warblers": "Fauvettes et pouillots",
  "guild_corvids": "Corvidés",
  "guild_swifts_swallows": "Martinets et hirondelles",
  "guild_pigeons_doves": "Pigeons et tourterelles",
  "guild_other": "Autres",
  "sys_api_label": "API bird-server",
  "sys_latency": "Latence",
  "sys_port": "Port",
  "sys_species_distinct": "Espèces distinctes",
  "sys_days_recorded": "Jours enregistrés",
  "sys_conf_range": "Confiance moy. / min / max",
  "sys_last_det": "Dernière détection",
  "sys_date_time": "Date / Heure",
  "sys_det_today": "Détections aujourd'hui",
  "sys_det_yesterday": "Détections hier",
  "sys_no_gap": "✓ Aucun gap détecté",
  "sys_no_gap_full": "✓ Aucun gap — données continues",
  "sys_gaps_found": "{n} gap(s) détecté(s) au total",
  "sys_gap_missing": "{n} jour(s) manquant(s)",
  "sys_gaps_title": "⚠️ Jours sans données (> {n} jour de gap)",
  "sys_activity_30d": "📈 Activité quotidienne — 30 derniers jours",
  "sys_hourly_distrib": "🕐 Distribution horaire globale",
  "rarity_threshold_label": "Seuil rarité (max détections)",
  "rarity_seen_once": "💎 Vues une seule fois",
  "rarity_last_rare": "🕐 Dernières détections rares",
  "latin_name": "Nom latin",
  "bio_total": "Total",
  "kpi_days_detected": "Jours détectée",
  "stats_daily_records": "🏆 Records journaliers",
  "stats_annual_evolution": "📅 Évolution annuelle",
  "stats_record_most_det": "Jour avec le + de détections",
  "stats_record_most_sp": "Jour avec le + d'espèces",
  "stats_record_max_conf": "Confiance maximale",
  "period": "Période",
  "conf_min": "Confiance min.",
  "sort_by": "Trier par",
  "quick_1d": "1j",
  "quick_7d": "7j",
  "quick_1m": "1m",
  "quick_3m": "3m",
  "quick_6m": "6m",
  "quick_30d": "30j",
  "quick_90d": "90j",
  "quick_1y": "1an",
  "quick_all": "Tout",
  "per_day_avg": "/ jour (moy.)",
  "trend": "Tendance",
  "best_recordings": "Meilleurs enregistrements",
  "sort_conf_desc": "Confiance ↓",
  "sort_date_desc": "Date ↓",
  "sort_species_az": "Espèce A→Z",
  "filter_species_ph": "Filtrer espèces…",
  "clear_all": "Tout effacer",
  "select_all": "Tout sélect.",
  "deselect_all": "Tout désélect.",
  "no_recordings": "Aucun enregistrement trouvé.",
  "load_more": "Charger plus",
  "remaining": "{n} restants",
  "clean_audio": "Nettoyer le son",
  "cleaned": "Nettoyé",
  "cleaning": "Nettoyage…",
  "force": "Force",
  "spectral_sub": "filtre passe-haut + soustraction spectrale",
  "af_gain": "Gain (dB)",
  "af_highpass": "Passe-haut (Hz)",
  "af_lowpass": "Passe-bas (Hz)",
  "af_off": "Off",
  "af_file_info": "Infos fichier",
  "af_duration": "Durée",
  "af_type": "Type",
  "af_size": "Taille",
  "af_sample_rate": "Fréq. échantillonnage",
  "af_channels": "Canaux",
  "af_file_path": "Chemin",
  "af_mono": "Mono",
  "af_stereo": "Stéréo",
  "af_filters": "Filtres audio",
  "mod_title": "Monitoring modèle",
  "mod_current": "Modèle actif",
  "mod_detections": "Détections",
  "mod_species": "Espèces",
  "mod_confidence": "Confiance moy.",
  "mod_rate": "Rythme",
  "mod_per_hour": "/h",
  "mod_conf_dist": "Distribution confiance",
  "mod_top_species": "Top espèces",
  "mod_trend": "Tendance 7j",
  "mod_no_data": "Pas de données",
  "mod_today": "Auj.",
  "mod_7d": "7j",
  "mod_30d": "30j",
  "cmp_title": "Comparaison de périodes",
  "cmp_split_date": "Date pivot",
  "cmp_before": "Avant",
  "cmp_after": "Après",
  "cmp_det_day": "Dét./jour",
  "cmp_species_gained": "Espèces gagnées",
  "cmp_species_lost": "Espèces perdues",
  "cmp_nocturnal": "Détections nocturnes",
  "cmp_nocturnal_sub": "22h – 4h",
  "cmp_none": "Aucune",
  "cmp_per_day": "/j",
  "cmp_change": "Variation",
  "cmp_species_detail": "Comparaison par espèce",
  "cmp_count": "Nb",
  "del_manage": "Gérer les détections",
  "del_this": "Supprimer cette détection",
  "del_all": "Supprimer tout",
  "del_confirm_title": "Suppression irréversible",
  "del_confirm_body": "Cette action supprimera {count} détections et tous les fichiers audio pour « {name} ». Cette action est irréversible.",
  "del_type_name": "Tapez « {name} » pour confirmer :",
  "del_permanently": "Supprimer définitivement",
  "cancel": "Annuler",
  "del_one_confirm": "Supprimer la détection du {date} à {time} (confiance : {conf}) ?\n\nLe fichier audio sera aussi supprimé.",
  "del_success": "détections supprimées",
  "del_file_errors": "fichiers non supprimés",
  "del_done_title": "Suppression terminée",
  "del_records_removed": "Détections supprimées",
  "del_files_removed": "Fichiers supprimés",
  "del_close": "Fermer",
  "avg_conf_short": "Confiance moy.",
  "days_detected": "Jours détectés",
  "activity_30d": "Activité — 30 jours",
  "conf_distribution": "Distribution de confiance",
  "activity_month_hour": "Activité saisonnière par heure",
  "description": "Description",
  "description_en": "Description (English)",
  "date_range": "Plage de dates",
  "mode": "Mode",
  "unique_mode": "Unique",
  "unique_desc": "Regroupe les séquences consécutives",
  "all_species_placeholder": "— Toutes espèces —",
  "today_label": "Aujourd'hui",
  "yesterday": "Hier",
  "hourly_distrib": "Distribution horaire",
  "click_to_edit": "Cliquer pour saisir",
  "never_seen": "jamais vu",
  "total_species": "Total espèces",
  "rare_count": "Rares (≤{n})",
  "seen_once": "Vues une fois",
  "new_this_year": "Nouvelles {year}",
  "idle": "Inactif",
  "connecting": "Connexion…",
  "live": "En direct",
  "start": "Démarrer",
  "stop": "Arrêter",
  "gain": "Gain",
  "freq_max": "Fréq. max",
  "clean": "Nettoyer",
  "today_count": "aujourd'hui",
  "spectro_title": "Spectrogramme live",
  "spectro_close": "Fermer spectrogramme",
  "spectro_show": "Afficher spectrogramme",
  "spectro_idle_msg": "Cliquez sur Démarrer pour activer le spectrogramme.",
  "spectro_idle_desc": "L'audio provient des MP3 récents de BirdNET — aucun conflit avec l'analyse en cours.",
  "spectro_idle_overlay": "Les détections apparaissent en overlay automatiquement.",
  "spectro_connecting_msg": "Connexion au flux audio du Pi…",
  "colorbar_max": "max",
  "colorbar_min": "min",
  "all_rarities": "Toutes les raretés",
  "updated_at": "Mis à jour",
  "ebird_notable_title": "eBird — Observations notables",
  "bw_period_today": "Auj.",
  "bw_period_week": "7j",
  "bw_period_month": "30j",
  "bw_period_all": "Tout",
  "unit_d": "j",
  "unit_h": "h",
  "unit_m": "m",
  "no_notable_obs": "Aucune observation notable ces 7 derniers jours.",
  "quick_today": "Auj.",
  "sys_health_title": "Santé du système",
  "sys_cpu": "CPU",
  "sys_ram": "RAM",
  "sys_disk": "Disque",
  "sys_temp": "Température",
  "sys_fan": "Ventilateur",
  "sys_uptime_label": "Uptime",
  "sys_load": "Charge",
  "sys_cores": "cœurs",
  "sys_services_title": "Services",
  "sys_svc_logs": "Journaux",
  "sys_svc_no_logs": "Aucun journal",
  "sys_confirm_stop": "Confirmer l'arrêt",
  "sys_confirm_stop_msg": "Arrêter le service « {name} » ? Cela peut interrompre l'analyse.",
  "sys_cancel": "Annuler",
  "sys_svc_starting": "Démarrage…",
  "sys_svc_stopping": "Arrêt…",
  "sys_analysis_title": "Analyse en cours",
  "sys_backlog": "Backlog",
  "sys_lag": "Retard",
  "sys_inference": "Inférence",
  "sys_model_active": "Modèle actif",
  "sys_files_pending": "fichiers en attente",
  "sys_seconds": "secondes",
  "sys_minutes": "min",
  "sys_audio_title": "Audio",
  "sys_rec_card": "Carte d'entrée",
  "sys_channels_label": "Canaux",
  "sys_format": "Format",
  "sys_backup_title": "Sauvegarde",
  "sys_backup_dest": "Destination",
  "sys_backup_mount": "Montage",
  "sys_last_backup": "Dernier backup",
  "sys_backup_size": "Taille",
  "sys_mounted": "Monté",
  "sys_not_mounted": "Non monté",
  "sys_not_configured": "Non configuré",
  "set_backup": "Sauvegarde",
  "set_backup_dest": "Destination",
  "set_backup_content": "Contenu à sauvegarder",
  "set_backup_dest_local": "Disque USB / Local",
  "set_backup_dest_smb": "Partage SMB/CIFS",
  "set_backup_dest_nfs": "Montage NFS",
  "set_backup_dest_sftp": "SFTP",
  "set_backup_dest_s3": "Amazon S3",
  "set_backup_dest_gdrive": "Google Drive",
  "set_backup_dest_webdav": "WebDAV",
  "set_backup_content_db": "Base de données",
  "set_backup_content_audio": "Fichiers audio",
  "set_backup_content_config": "Configuration",
  "set_backup_content_all": "Tout sauvegarder",
  "set_backup_path": "Chemin / Point de montage",
  "set_backup_host": "Serveur",
  "set_backup_port": "Port",
  "set_backup_user": "Utilisateur",
  "set_backup_pass": "Mot de passe",
  "set_backup_share": "Partage",
  "set_backup_bucket": "Bucket",
  "set_backup_region": "Région",
  "set_backup_access_key": "Clé d'accès",
  "set_backup_secret_key": "Clé secrète",
  "set_backup_remote_path": "Chemin distant",
  "set_backup_schedule": "Planification",
  "set_backup_schedule_manual": "Manuel uniquement",
  "set_backup_schedule_daily": "Quotidien",
  "set_backup_schedule_weekly": "Hebdomadaire",
  "set_backup_schedule_time": "Heure de sauvegarde",
  "set_backup_retention": "Rétention (jours)",
  "set_backup_run_now": "Lancer maintenant",
  "set_backup_running": "Sauvegarde en cours…",
  "set_backup_save": "Enregistrer la configuration backup",
  "set_backup_saved": "Configuration backup enregistrée",
  "set_backup_last_status": "Dernier statut",
  "set_backup_never": "Jamais exécuté",
  "set_backup_success": "Succès",
  "set_backup_failed": "Échoué",
  "set_backup_gdrive_folder": "ID du dossier Google Drive",
  "set_backup_state_running": "En cours",
  "set_backup_state_completed": "Terminé",
  "set_backup_state_failed": "Échoué",
  "set_backup_state_stopped": "Arrêté",
  "set_backup_state_paused": "En pause",
  "set_backup_step": "Étape",
  "set_backup_started": "Démarré il y a",
  "set_backup_pause": "Pause",
  "set_backup_resume": "Reprendre",
  "set_backup_stop": "Arrêter",
  "set_backup_stop_confirm": "Arrêter le backup en cours ? (rsync reprendra au prochain lancement)",
  "set_backup_transferred": "Transféré",
  "set_backup_disk_free": "Espace libre",
  "sys_network_title": "Réseau",
  "sys_hostname": "Nom d'hôte",
  "sys_ip": "Adresse IP",
  "sys_gateway": "Passerelle",
  "sys_internet": "Internet",
  "sys_nas_ping": "Ping NAS",
  "sys_reachable": "Joignable",
  "sys_unreachable": "Injoignable",
  "sys_hardware_title": "Matériel",
  "nav_prev_day": "Jour précédent",
  "nav_next_day": "Jour suivant",
  "select_species_prompt": "Sélectionnez une espèce",
  "listen_spectro_hint": "pour écouter et voir le spectrogramme",
  "next_det_audio": "Prochaine détection avec audio →",
  "download": "Télécharger",
  "download_audio": "Télécharger l'audio",
  "ebird_export": "Export eBird",
  "click_to_edit_value": "Cliquer pour saisir une valeur",
  "search_filter_ph": "filtrer…",
  "search_species_ph": "Rechercher… (appuyez /)",
  "fft_analysis": "Analyse FFT…",
  "ebird_api_missing": "Clé API manquante",
  "ebird_enable_text": "Pour activer cette section, obtenez une clé gratuite sur",
  "ebird_then_configure": "puis configurez-la sur le Pi :",
  "ebird_add_env": "Ajouter :",
  "ebird_your_key": "votre_cle",
  "ebird_no_notable": "Aucune observation notable ces 7 derniers jours.",
  "ebird_see_on": "Voir sur eBird",
  "bw_see_on": "Voir sur BirdWeather",
  "bw_add_in": "Ajouter dans",
  "bw_id_in_url": "L'ID est visible dans l'URL :",
  "top_detected": "Top espèces détectées",
  "detected_locally": "Également détecté localement",
  "not_detected_locally": "Pas détecté localement",
  "no_rarities_detected": "Aucune rareté détectée récemment",
  "search_placeholder": "Rechercher une espèce…",
  "lifers_label": "Lifers",
  "no_lifers": "Aucun lifer pour cette date",
  "morning_summary": "Quoi de neuf",
  "new_today": "Nouvelles aujourd'hui",
  "best_detection": "Meilleure détection",
  "vs_yesterday": "vs hier",
  "no_new_species": "Aucune nouvelle espèce",
  "wn_title": "Quoi de neuf",
  "wn_level_alerts": "Alertes",
  "wn_level_phenology": "Phénologie",
  "wn_level_context": "Contexte du jour",
  "wn_card_out_of_season": "Espèce hors-saison",
  "wn_card_activity_spike": "Pic d'activité",
  "wn_card_species_return": "Retour après absence",
  "wn_card_first_of_year": "Première de l'année",
  "wn_card_species_streak": "Présence consécutive",
  "wn_card_seasonal_peak": "Pic saisonnier",
  "wn_card_dawn_chorus": "Chorus auroral",
  "wn_card_acoustic_quality": "Qualité acoustique",
  "wn_card_species_richness": "Richesse spécifique",
  "wn_card_moon_phase": "Phase lunaire",
  "wn_insuf_label": "Données insuffisantes",
  "wn_insuf_needsWeek": "Cette carte nécessite au moins 7 jours de détections. Elle s'activera automatiquement une fois cette période écoulée.",
  "wn_insuf_needsTwoWeeks": "Cette carte nécessite au moins 15 jours de détections pour identifier les absences significatives.",
  "wn_insuf_needsMonth": "Cette carte nécessite au moins 28 jours de données pour calculer une ligne de base fiable.",
  "wn_insuf_needsSeason": "Cette carte nécessite au moins un an de données pour comparer les pics saisonniers.",
  "wn_insuf_needsGPS": "Coordonnées GPS non configurées. Renseignez LATITUDE et LONGITUDE dans /etc/birdnet/birdnet.conf.",
  "wn_insuf_tooEarly": "Pas encore assez de détections aujourd'hui. Revenez dans quelques heures.",
  "wn_moon_new_moon": "Nouvelle lune",
  "wn_moon_waxing_crescent": "Premier croissant",
  "wn_moon_first_quarter": "Premier quartier",
  "wn_moon_waxing_gibbous": "Gibbeuse croissante",
  "wn_moon_full_moon": "Pleine lune",
  "wn_moon_waning_gibbous": "Gibbeuse décroissante",
  "wn_moon_last_quarter": "Dernier quartier",
  "wn_moon_waning_crescent": "Dernier croissant",
  "wn_migration_favorable": "Migration favorable",
  "wn_migration_moderate": "Migration modérée",
  "wn_migration_limited": "Migration limitée",
  "wn_quality_good": "Bonne",
  "wn_quality_moderate": "Modérée",
  "wn_quality_poor": "Mauvaise",
  "wn_trend_above": "Au-dessus",
  "wn_trend_normal": "Normal",
  "wn_trend_below": "En-dessous",
  "wn_spike_ratio": "× la moyenne",
  "wn_streak_days": "jours consécutifs",
  "wn_absent_days": "jours d'absence",
  "wn_species_detected": "espèces détectées",
  "wn_detections": "détections",
  "wn_vs_avg": "vs moy.",
  "wn_illumination": "Illumination",
  "wn_acceptance_rate": "Taux d'acceptation",
  "wn_strong_detections": "Détections solides",
  "phenology": "Phénologie",
  "first_arrival": "Première arrivée",
  "last_departure": "Dernier départ",
  "quick_play": "Écoute rapide",
  "validation_confirmed": "Confirmée",
  "validation_doubtful": "Douteuse",
  "validation_rejected": "Rejetée",
  "validation_unreviewed": "Non vérifiée",
  "hide_rejected": "Masquer rejetées",
  "validation_stats": "Statistiques de validation",
  "tl_title": "Journal du jour",
  "tl_notable": "événements notables",
  "tl_full_view": "Vue complète",
  "tl_see_full": "Voir la timeline complète",
  "tl_loading": "Chargement…",
  "tl_prev_day": "Jour précédent",
  "tl_next_day": "Jour suivant",
  "tl_species": "espèces",
  "tl_detections": "détections",
  "tl_chronology": "Chronologie des événements",
  "tl_see_species": "Voir la fiche espèce",
  "tl_see_today": "Voir le jour",
  "tl_listen": "Écouter",
  "tl_validate": "Valider",
  "tl_density_label": "Intensité des détections",
  "tl_density_label_short": "Oiseaux",
  "tl_now": "maintenant",
  "tl_drag_hint": "glisser pour zoomer",
  "tl_type_nocturnal": "🌙 Nocturne",
  "tl_type_rare": "⭐ Rare",
  "tl_type_firstyear": "🌱 1ère de l'année",
  "tl_type_firstday": "🐦 1ère diurne",
  "tl_type_best": "🎵 Meilleure",
  "tl_type_out_of_season": "⚠️ Hors-saison",
  "tl_type_species_return": "🔄 Retour",
  "tl_type_top_species": "🐦 Espèces",
  "tl_density_0": "Très peu",
  "tl_density_1": "Peu",
  "tl_density_2": "Normal",
  "tl_density_3": "Plus",
  "tl_density_4": "Maximum",
  "tl_density_5": "Tout",
  "tl_tag_nocturnal": "Nocturne",
  "tl_tag_strict_nocturnal": "Nocturne strict",
  "tl_tag_migration": "Migration",
  "tl_tag_out_of_season": "Hors-saison",
  "tl_tag_rare": "Rare",
  "tl_tag_firstyear": "1ère de l'année",
  "tl_tag_firstday": "1ère diurne",
  "tl_tag_best": "Meilleure confiance",
  "tl_tag_species_return": "Retour",
  "tl_tag_activity_spike": "Pic d'activité",
  "tl_tag_top_species": "Vedette du jour",
  "tl_sunrise": "Lever",
  "tl_sunset": "Coucher",
  "tl_confidence": "Confiance"
}
  };
  const _AVAILABLE_LANGS = ['fr', 'en', 'de', 'nl'];

  const _i18nLoaded = (async () => {
    const base = (window.BIRD_CONFIG && window.BIRD_CONFIG.baseUrl) || '/birds';
    const others = _AVAILABLE_LANGS.filter(l => l !== 'fr');
    const results = await Promise.all(
      others.map(lang =>
        fetch(`${base}/i18n/${lang}.json`).then(r => r.json()).catch(e => {
          console.warn(`[i18n] Failed to load ${lang}:`, e.message);
          return null;
        })
      )
    );
    others.forEach((lang, i) => {
      if (results[i]) _TRANSLATIONS[lang] = results[i];
    });
  })();

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

    const langs = _AVAILABLE_LANGS.filter(code => _TRANSLATIONS[code]).map(code => ({
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
    dashboard:    'nav_dashboard',
    overview:     'nav_overview',
    today:        'nav_today',
    calendar:     'nav_calendar',
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
    favorites:    'nav_favorites',
    weather:      'nav_weather',
    log:          'nav_log',
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


  // ── useAudioPlayer ──────────────────────────────────────────────────────
  // Shared audio player composable for spectrogram pages.
  // Options: { filters: false } — set true to enable Web Audio gain/HP/LP.
  function useAudioPlayer(opts = {}) {
    let _audio = null, _rafId = null;
    const isPlaying        = ref(false);
    const audioProgress    = ref(0);
    const audioCurrentTime = ref(0);
    const audioDuration    = ref(0);

    // Filter support (opt-in)
    const filters = opts.filters ? Vue.reactive({ gain: 0, highpass: 0, lowpass: 0 }) : null;
    let _audioCtx = null, _sourceNode = null, _gainNode = null, _hpNode = null, _lpNode = null;

    function _buildFilterChain() {
      if (!_audioCtx || !_audio || _sourceNode) return;
      _sourceNode = _audioCtx.createMediaElementSource(_audio);
      _gainNode = _audioCtx.createGain();
      _gainNode.gain.value = Math.pow(10, (filters?.gain || 0) / 20);
      _hpNode = _audioCtx.createBiquadFilter();
      _hpNode.type = 'highpass'; _hpNode.frequency.value = filters?.highpass || 0;
      _lpNode = _audioCtx.createBiquadFilter();
      _lpNode.type = 'lowpass'; _lpNode.frequency.value = filters?.lowpass || (_audioCtx.sampleRate / 2);
      _sourceNode.connect(_hpNode); _hpNode.connect(_lpNode); _lpNode.connect(_gainNode); _gainNode.connect(_audioCtx.destination);
    }

    function setFilter(key, val) {
      if (!filters) return;
      filters[key] = val;
      if (_gainNode && key === 'gain') _gainNode.gain.value = Math.pow(10, val / 20);
      if (_hpNode && key === 'highpass') _hpNode.frequency.value = val || 0;
      if (_lpNode && key === 'lowpass') _lpNode.frequency.value = val || (_audioCtx ? _audioCtx.sampleRate / 2 : 22050);
    }

    function _startRaf() {
      if (_rafId) return;
      function tick() {
        if (_audio && !_audio.paused && _audio.duration) {
          audioCurrentTime.value = _audio.currentTime;
          audioProgress.value    = _audio.currentTime / _audio.duration;
          _rafId = requestAnimationFrame(tick);
        } else { _rafId = null; }
      }
      _rafId = requestAnimationFrame(tick);
    }
    function _stopRaf() { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } }

    function play(url) {
      if (!url) return;
      if (_audio && isPlaying.value)  { _audio.pause(); return; }
      if (_audio && !isPlaying.value) { _audio.play().catch(()=>{}); return; }
      if (filters) {
        if (!_audioCtx || _audioCtx.state === 'closed') {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        _sourceNode = null;
      }
      _audio = new Audio(url);
      if (filters) { _audio.crossOrigin = 'anonymous'; _buildFilterChain(); }
      _audio.addEventListener('play',  () => { isPlaying.value = true; audioDuration.value = _audio.duration || 0; _startRaf(); });
      _audio.addEventListener('pause', () => { isPlaying.value = false; _stopRaf(); });
      _audio.addEventListener('ended', () => { isPlaying.value = false; audioProgress.value = 0; audioCurrentTime.value = 0; _stopRaf(); });
      _audio.addEventListener('loadedmetadata', () => { audioDuration.value = _audio.duration || 0; });
      _audio.play().catch(() => {});
    }

    function stop() {
      _stopRaf();
      if (_audio) { _audio.pause(); _audio = null; }
      _sourceNode = null;
      isPlaying.value = false; audioProgress.value = 0;
      audioCurrentTime.value = 0; audioDuration.value = 0;
    }

    function seekFraction(fraction) {
      if (_audio && _audio.duration) _audio.currentTime = fraction * _audio.duration;
    }
    function seekFromEvent(e) {
      if (!_audio || !_audio.duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      _audio.currentTime = ((e.clientX - rect.left) / rect.width) * _audio.duration;
    }

    function fmtDuration(s) {
      if (!s) return '0:00';
      return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
    }

    onUnmounted(() => { stop(); if (_audioCtx) { try { _audioCtx.close(); } catch{} _audioCtx = null; } });

    const result = { isPlaying, audioProgress, audioCurrentTime, audioDuration, play, stop, seekFraction, seekFromEvent, fmtDuration };
    if (filters) { result.filters = filters; result.setFilter = setFilter; }
    return result;
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

      const drawerOpen = ref(false);
      function toggleDrawer() { drawerOpen.value = !drawerOpen.value; }
      function drawerNavClick(si) { navSectionClick(si); }
      return { lang, t, setLang, langs, theme, themes, setTheme, navItems, navSections, openSection, navSectionClick, siteName, langOpen, themeOpen, currentLang, currentTheme, modelName, currentPage, reviewCount, searchQuery, searchOpen, searchExpanded, searchHighlight, searchResults, onSearchInput, selectSearchResult, onSearchKeydown, closeSearch, toggleMobileSearch, bellOpen, bellItems, bellCount, bellUnseen, toggleBell, toasts, brandName, refreshReviewCount, drawerOpen, toggleDrawer, drawerNavClick };
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
    <a href="overview.html" class="mob-nav-item" :class="{active: currentPage==='overview'}"><span class="mob-nav-icon">🏠</span>{{t('nav_overview')}}</a>
    <a href="today.html" class="mob-nav-item" :class="{active: currentPage==='today'}"><span class="mob-nav-icon">📅</span>{{t('nav_today')}}</a>
    <a href="species.html" class="mob-nav-item" :class="{active: currentPage==='species'}"><span class="mob-nav-icon">🦜</span>{{t('nav_species')}}</a>
    <a href="stats.html" class="mob-nav-item" :class="{active: currentPage==='stats'}"><span class="mob-nav-icon">📈</span>{{t('nav_stats')}}</a>
    <button class="mob-nav-item" :class="{active: drawerOpen}" @click="toggleDrawer"><span class="mob-nav-icon">☰</span>{{t('nav_more')}}</button>
  </nav>
  <transition name="drawer">
    <div v-if="drawerOpen" class="mob-drawer-overlay" @click.self="drawerOpen=false">
      <nav class="mob-drawer" aria-label="Full navigation">
        <div class="mob-drawer-header">
          <span class="mob-drawer-brand">{{brandName}}</span>
          <button class="mob-drawer-close" @click="drawerOpen=false" aria-label="Close">✕</button>
        </div>
        <div v-for="(sec, si) in navSections" :key="si" class="mob-drawer-section">
          <button class="mob-drawer-sec-btn" @click="drawerNavClick(si)">
            <span>{{sec.icon}} {{sec.section}}</span>
            <svg :class="{rotated: openSection===si}" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div v-if="openSection===si" class="mob-drawer-pages">
            <a v-for="p in sec.items" :key="p.id" :href="p.file"
               class="mob-drawer-link" :class="{active: p.active}">
              <span>{{p.icon}} {{p.label}}</span>
              <span v-if="p.id==='review' && reviewCount > 0" class="nav-badge">{{reviewCount}}</span>
            </a>
          </div>
        </div>
      </nav>
    </div>
  </transition>
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
    useI18n, useTheme, useNav, useChart, useAudio, useAudioPlayer, useFavorites, useSpeciesNames, useToast, updateSiteIdentity, exportChart,
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
    ready: _i18nLoaded,
  };

})(Vue, BIRD_CONFIG, window.BIRDASH_UTILS);
