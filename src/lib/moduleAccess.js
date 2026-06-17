export function getDesktopModules(profile) {
  return Array.isArray(profile?.allowed_modules) ? profile.allowed_modules : [];
}

export function getMobileModules(profile) {
  return Array.isArray(profile?.mobile_allowed_modules) ? profile.mobile_allowed_modules : [];
}

export function getEffectiveModules(profile, isMobile = false) {
  const desktopModules = getDesktopModules(profile);

  if (!isMobile || !Array.isArray(profile?.mobile_allowed_modules)) return desktopModules;

  const mobileModules = getMobileModules(profile);
  const desktopSet = new Set(desktopModules);
  return mobileModules.filter(moduleId => desktopSet.has(moduleId));
}

export function canOpenModule(profile, moduleId, isMobile = false) {
  if (profile?.role === "super_admin") return true;
  if (moduleId === "adminUsers") return false;

  if (moduleId === "preciosHistoricos") {
    const modules = getEffectiveModules(profile, isMobile);
    return modules.includes("preciosHistoricos")
      || modules.includes("tenders")
      || modules.includes("cotizador");
  }

  return getEffectiveModules(profile, isMobile).includes(moduleId);
}

const DEFAULT_MODULE_ORDER = [
  "managerDashboard",
  "sellerDashboard",
  "todayActions",
  "visits",
  "calendar",
  "accounts",
  "opportunities",
  "products",
  "campaigns",
  "tenders",
  "cotizador",
  "importer",
  "salesAnalytics",
  "tasks",
  "notifications",
  "settings",
];

export function getFirstOpenModule(profile, isMobile = false) {
  if (profile?.role === "super_admin") return "managerDashboard";
  return DEFAULT_MODULE_ORDER.find(moduleId => canOpenModule(profile, moduleId, isMobile)) || null;
}
