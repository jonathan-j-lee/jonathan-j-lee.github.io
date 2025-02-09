export default {
  getIntParam: (name: string, defaultValue: number = 0) =>
    getNumericParam(parseInt, name, defaultValue),
  getFloatParam: (name: string, defaultValue: number = 0) =>
    getNumericParam(parseFloat, name, defaultValue),
};

function getNumericParam(
  parseFn: (rawValue: string) => number,
  name: string,
  defaultValue: number = 0,
): number {
  let rawValue = new URL(location.href).searchParams.get(name);
  if (!rawValue) {
    return defaultValue;
  }
  let value = parseFn(rawValue);
  return isNaN(value) ? defaultValue : value;
}
