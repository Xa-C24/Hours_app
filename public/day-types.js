(function () {
  const baseOptions = [
    { value: "office", label: "Bureau", isWorkedDay: true },
    { value: "remote", label: "Télétravail", isWorkedDay: true },
    { value: "leave", label: "Congés", isWorkedDay: false },
    { value: "rtt", label: "RTT", isWorkedDay: false },
    { value: "sick_leave", label: "Arrêt", isWorkedDay: false },
    { value: "holiday", label: "Férié", isWorkedDay: false },
  ];
  // Keep the existing day_type text column and one record per date. The order
  // of the two validated values explicitly represents morning then afternoon.
  const options = [...baseOptions];
  for (const morning of baseOptions) {
    for (const afternoon of baseOptions) {
      if (morning.value === afternoon.value) continue;
      options.push({
        value: `${morning.value}__${afternoon.value}`,
        label: `Matin : ${morning.label} · Après-midi : ${afternoon.label}`,
        isWorkedDay: morning.isWorkedDay || afternoon.isWorkedDay,
      });
    }
  }
  const configs = new Map(options.map(option => [option.value, option]));
  function parts(value) {
    if (!configs.has(value)) return [];
    return value.includes("__") ? value.split("__") : [value, value];
  }
  function fraction(value, type) {
    return parts(value).filter(part => part === type).length / 2;
  }
  function workedFraction(value) {
    return parts(value).filter(part => part === "office" || part === "remote").length / 2;
  }
  const api = { baseOptions, options, parts, fraction, workedFraction };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.hoursDayTypes = api;
})();
