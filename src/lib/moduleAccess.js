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
  if (moduleId === "managerDashboard") return true;
  return getEffectiveModules(profile, isMobile).includes(moduleId);
}
