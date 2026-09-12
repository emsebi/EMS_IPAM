function parts(date = new Date(), options = {}) {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...options,
  });
  return Object.fromEntries(formatter.formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
}

export function jalaliDate(date = new Date()) {
  const value = parts(date);
  return `${value.year}/${value.month}/${value.day}`;
}

export function jalaliDateTime(date = new Date()) {
  const value = parts(date);
  return `${value.year}/${value.month}/${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

export function jalaliFilenameStamp(date = new Date()) {
  const value = parts(date);
  return `${value.year}-${value.month}-${value.day}_${value.hour}-${value.minute}`;
}

