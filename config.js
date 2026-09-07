window.PARKS_CONFIG = {
  supabaseUrl: "https://xmiushrjmlatrogfrsxu.supabase.co",
  // Pega aquí la Publishable key (sb_publishable_...). Nunca uses la Secret key.
  supabaseAnonKey: "sb_publishable_fMFhhpXsDy4R723oWPBcbw_uTMIHivS",
  bucket: "parks-documentos",
  inactivityMinutes: 30,
  maxUploadMB: 50,
  allowedUploadExtensions: ["pdf","png","jpg","jpeg","docx","xlsx"],
  allowedUploadMimeTypes: [
    "application/pdf","image/png","image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ],
  demoMode: false
};
