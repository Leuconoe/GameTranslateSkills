export function parseArgs(argv) {
  const args = { _: [] };

  const assign = (key, value) => {
    if (Object.hasOwn(args, key)) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      args._.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const raw = token.slice(2);
    const equals = raw.indexOf('=');
    const key = (equals === -1 ? raw : raw.slice(0, equals)).toLowerCase().replaceAll('_', '-');
    let value = equals === -1 ? undefined : raw.slice(equals + 1);
    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('-')) {
      value = argv[index + 1];
      index += 1;
    }
    assign(key, value === undefined ? true : value);
  }

  return args;
}

export function option(args, ...names) {
  for (const name of names) {
    const key = name.toLowerCase().replaceAll('_', '-');
    if (Object.hasOwn(args, key)) return args[key];
  }
  return undefined;
}

export function flag(args, name) {
  const value = option(args, name);
  return value === true || value === 'true';
}

export function requiredOption(args, name) {
  const value = option(args, name);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required option: --${name}`);
  }
  return value.trim();
}
