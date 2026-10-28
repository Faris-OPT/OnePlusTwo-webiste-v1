/* Saving to GitHub. Every publish becomes one commit on the deploy branch, and Vercel then republishes the site.
   Needs GITHUB_TOKEN (fine-grained, this repository only, "Contents: read and write"), GITHUB_REPO and GITHUB_BRANCH. */

const API = 'https://api.github.com';

function cfg() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'Faris-OPT/OnePlusTwo-webiste-v1';
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) { const e = new Error('GITHUB_TOKEN is not set in Vercel, so the back office cannot save.'); e.status = 500; throw e; }
  return { token, repo, branch };
}

async function gh(path, opts) {
  const c = cfg();
  opts = opts || {};
  const r = await fetch(API + path.replace('{repo}', c.repo), {
    method: opts.method || 'GET',
    headers: {
      authorization: 'Bearer ' + c.token,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'oneplustwo-back-office',
      ...(opts.body ? { 'content-type': 'application/json' } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text }; }
  if (!r.ok) {
    const err = new Error('GitHub: ' + ((data && data.message) || r.status));
    err.status = r.status === 404 ? 404 : (r.status === 409 || r.status === 422 ? 409 : 502);
    err.github = r.status;
    throw err;
  }
  return data;
}

async function getFile(path) {
  const c = cfg();
  const d = await gh('/repos/{repo}/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(c.branch));
  if (Array.isArray(d) || d.type !== 'file') { const e = new Error('Not a file'); e.status = 400; throw e; }
  let content = d.content;
  if (!content && d.git_url) { const blob = await gh(d.git_url.replace(API, '')); content = blob.content; }
  return { path: d.path, sha: d.sha, content: Buffer.from(content || '', 'base64').toString('utf8') };
}

async function headTree() {
  const c = cfg();
  const ref = await gh('/repos/{repo}/git/ref/heads/' + encodeURIComponent(c.branch));
  const commit = await gh('/repos/{repo}/git/commits/' + ref.object.sha);
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

async function listFiles() {
  const h = await headTree();
  const t = await gh('/repos/{repo}/git/trees/' + h.treeSha + '?recursive=1');
  return t.tree.filter((x) => x.type === 'blob').map((x) => ({ path: x.path, sha: x.sha, size: x.size }));
}

/* files: [{ path, content (utf-8 text) | base64, baseSha?, remove? }]
   baseSha is the version the person started editing. If the file has changed since, nothing is saved (409). */
async function commitFiles(files, message, author, attempt) {
  attempt = attempt || 1;
  const c = cfg();
  const h = await headTree();
  const needsCheck = files.some((f) => f.baseSha || f.remove || f.mustNotExist);
  if (needsCheck) {
    const t = await gh('/repos/{repo}/git/trees/' + h.treeSha + '?recursive=1');
    const current = {};
    t.tree.forEach((x) => { if (x.type === 'blob') current[x.path] = x.sha; });
    const conflicts = files.filter((f) => (f.baseSha && current[f.path] && current[f.path] !== f.baseSha) || (f.mustNotExist && current[f.path])).map((f) => f.path);
    if (conflicts.length) { const e = new Error('conflict'); e.status = 409; e.conflicts = conflicts; throw e; }
    files = files.filter((f) => !f.remove || current[f.path]);
  }
  const entries = [];
  for (const f of files) {
    if (f.remove) { entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const blob = await gh('/repos/{repo}/git/blobs', { method: 'POST', body: f.base64 != null ? { content: f.base64, encoding: 'base64' } : { content: f.content, encoding: 'utf-8' } });
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await gh('/repos/{repo}/git/trees', { method: 'POST', body: { base_tree: h.treeSha, tree: entries } });
  const commit = await gh('/repos/{repo}/git/commits', {
    method: 'POST',
    body: {
      message: message + '\n\nPublished from the back office by ' + author.name + ' <' + author.email + '>',
      tree: tree.sha,
      parents: [h.commitSha],
      author: { name: author.name, email: author.email, date: new Date().toISOString() }
    }
  });
  try {
    await gh('/repos/{repo}/git/refs/heads/' + encodeURIComponent(c.branch), { method: 'PATCH', body: { sha: commit.sha, force: false } });
  } catch (e) {
    /* Someone else published in the same second: start again from the new latest version once. */
    if (attempt < 3 && (e.github === 422 || e.github === 409)) return commitFiles(files, message, author, attempt + 1);
    throw e;
  }
  return { sha: commit.sha, url: commit.html_url };
}

async function history(limit) {
  const c = cfg();
  const list = await gh('/repos/{repo}/commits?sha=' + encodeURIComponent(c.branch) + '&per_page=' + (limit || 30));
  return list.map((x) => {
    const msg = x.commit.message || '';
    const m = msg.match(/Published from the back office by ([^<]+) </);
    return {
      sha: x.sha,
      title: msg.split('\n')[0],
      who: m ? m[1].trim() : (x.commit.author && x.commit.author.name) || 'Unknown',
      when: x.commit.author && x.commit.author.date,
      fromAdmin: !!m,
      url: x.html_url
    };
  });
}

module.exports = { cfg, getFile, listFiles, commitFiles, history };
