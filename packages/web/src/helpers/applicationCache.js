import api from '../api';

// Simple in-memory cache for applications
const cache = {
  loaded: false,
  byId: {},
};

const normalizeAppObj = (appRow) => {
  if (!appRow) return null;
  // Expect rows from API to include application_id, make, model, engine, display
  const { application_id, make, model, engine, display } = appRow;
  return {
    application_id: application_id || (appRow.id || null),
    make: make || appRow.make || null,
    model: model || appRow.model || null,
    engine: engine || appRow.engine || null,
    display: display || appRow.display || [make || appRow.make, model || appRow.model, engine || appRow.engine].filter(Boolean).join(' '),
  };
};

export const loadApplications = async () => {
  if (cache.loaded) return cache.byId;
  try {
    const res = await api.get('/applications');
    const apps = res.data || [];
    cache.byId = {};
    apps.forEach(a => {
      const norm = normalizeAppObj(a);
      if (norm && norm.application_id != null) cache.byId[norm.application_id] = norm;
    });
    cache.loaded = true;
    return cache.byId;
  } catch (err) {
    console.error('Failed to load applications for cache', err);
    // leave cache empty
    cache.byId = {};
    cache.loaded = true;
    return cache.byId;
  }
};

export const getApplication = (id) => {
  if (!id) return null;
  return cache.byId[id] || null;
};

/**
 * Enrich a single applications field into readable objects/strings
 * Accepts: number|string (id), object, array
 */
export const enrichApplicationsField = async (applications) => {
  await loadApplications();
  if (!applications) return applications;

  if (Array.isArray(applications)) {
    return applications.map(a => {
      if (!a) return null;
      if (typeof a === 'object') {
        // If it's an object with only application_id, try to resolve to cached full object
        if (a.application_id && !(a.make || a.model || a.engine || a.display)) {
          return cache.byId[a.application_id] || a.application_id;
        }
        return a;
      }
      // numeric id or numeric string
      const parsed = typeof a === 'number' ? a : (typeof a === 'string' && /^\d+$/.test(a.trim()) ? parseInt(a.trim(), 10) : null);
      if (parsed != null) {
        return cache.byId[parsed] || parsed;
      }
      return a; // fallback (string label)
    }).filter(Boolean);
  }

  // single object
  if (typeof applications === 'object') {
    if (applications.application_id && !(applications.make || applications.model || applications.engine || applications.display)) {
      return cache.byId[applications.application_id] || applications.application_id;
    }
    return applications;
  }

  // Handle comma-separated numeric id strings like "7, 3"
  if (typeof applications === 'string') {
    const maybeList = applications.split(',').map(s => s.trim()).filter(Boolean);
    if (maybeList.length > 1) {
      return maybeList.map(token => {
        const n = /^\d+$/.test(token) ? parseInt(token, 10) : null;
        return n != null ? (cache.byId[n] || n) : token;
      }).filter(Boolean);
    }
    const single = applications.trim();
    const parsedSingle = /^\d+$/.test(single) ? parseInt(single, 10) : null;
    if (parsedSingle != null) return cache.byId[parsedSingle] || parsedSingle;
    return applications;
  }

  const parsed = typeof applications === 'number' ? applications : null;
  if (parsed != null) return cache.byId[parsed] || parsed;
  return applications;
};

/**
 * Enrich an array of part objects from the power-search result
 * Each part may have `applications` which could be ids/strings/objects
 */
export const enrichPartsArray = async (parts) => {
  if (!parts || !Array.isArray(parts)) return parts;
  await loadApplications();
  return parts.map(part => {
    const apps = part.applications;
    if (!apps) return part;
    let enriched;
    if (Array.isArray(apps)) {
      enriched = apps.map(a => {
        if (!a) return null;
        if (typeof a === 'object') {
          if (a.application_id && !(a.make || a.model || a.engine || a.display)) {
            return cache.byId[a.application_id] || a.application_id;
          }
          return a;
        }
        const parsed = typeof a === 'number' ? a : (typeof a === 'string' && /^\d+$/.test(a) ? parseInt(a, 10) : null);
        return parsed != null ? (cache.byId[parsed] || parsed) : a;
      }).filter(Boolean);
    } else if (typeof apps === 'object') {
      if (apps.application_id && !(apps.make || apps.model || apps.engine || apps.display)) {
        enriched = cache.byId[apps.application_id] || apps.application_id;
      } else {
        enriched = apps;
      }
    } else {
      // If apps is a comma-separated string of ids like "7, 3", split and resolve
      if (typeof apps === 'string' && apps.includes(',')) {
        const tokens = apps.split(',').map(s => s.trim()).filter(Boolean);
        enriched = tokens.map(tok => {
          const n = /^\d+$/.test(tok) ? parseInt(tok, 10) : null;
          return n != null ? (cache.byId[n] || n) : tok;
        }).filter(Boolean);
      } else {
        const parsed = typeof apps === 'number' ? apps : (typeof apps === 'string' && /^\d+$/.test(String(apps).trim()) ? parseInt(String(apps).trim(), 10) : null);
        enriched = parsed != null ? (cache.byId[parsed] || parsed) : apps;
      }
    }
    return { ...part, applications: enriched };
  });
};

/**
 * Enrich a single part object (e.g., detail fetch)
 */
export const enrichPart = async (part) => {
  if (!part) return part;
  await loadApplications();
  const apps = part.applications;
  if (!apps) return part;
  if (Array.isArray(apps)) {
    const enriched = apps.map(a => {
      if (!a) return null;
      if (typeof a === 'object') {
        if (a.application_id && !(a.make || a.model || a.engine || a.display)) {
          return cache.byId[a.application_id] || a.application_id;
        }
        return a;
      }
      const parsed = typeof a === 'number' ? a : (typeof a === 'string' && /^\d+$/.test(a.trim()) ? parseInt(a.trim(), 10) : null);
      return parsed != null ? (cache.byId[parsed] || parsed) : a;
    }).filter(Boolean);
    return { ...part, applications: enriched };
  }
  if (typeof apps === 'object') return part;
  if (typeof apps === 'string' && apps.includes(',')) {
    const tokens = apps.split(',').map(s => s.trim()).filter(Boolean);
    const enriched = tokens.map(tok => {
      const n = /^\d+$/.test(tok) ? parseInt(tok, 10) : null;
      return n != null ? (cache.byId[n] || n) : tok;
    }).filter(Boolean);
    return { ...part, applications: enriched };
  }
  const parsed = typeof apps === 'number' ? apps : (typeof apps === 'string' && /^\d+$/.test(String(apps).trim()) ? parseInt(String(apps).trim(), 10) : null);
  return { ...part, applications: parsed != null ? (cache.byId[parsed] || parsed) : apps };
};

export default {
  loadApplications,
  getApplication,
  enrichApplicationsField,
  enrichPartsArray,
  enrichPart,
};
