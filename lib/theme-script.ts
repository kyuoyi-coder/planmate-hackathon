/**
 * Applies the saved appearance (Light, Dark or System) to <html> before the
 * first paint. Rendered as an inline script in the root layout's <head>, so
 * there is no flash of the wrong theme, and the theme never has to be read on
 * the server. With "System", it also follows OS changes live.
 *
 * Kept out of the "use client" theme module so the server layout receives the
 * plain string.
 */
export const THEME_STORAGE_KEY = "planmate-theme";

export const THEME_SCRIPT = `(function(){var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function apply(){var c;try{c=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}if(c!=="light"&&c!=="dark")c="system";var t=c==="system"?(m.matches?"dark":"light"):c;d.classList.remove("light","dark");d.classList.add(t);d.style.colorScheme=t;d.setAttribute("data-theme-choice",c)}apply();m.addEventListener("change",apply);window.__planmateApplyTheme=apply})()`;
