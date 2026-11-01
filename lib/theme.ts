export const THEME_STORAGE_KEY = 'agent-control-theme'

// Runs before paint (inlined in <head>) so a stored light theme never flashes dark
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`
