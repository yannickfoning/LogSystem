import re
with open('routes/import.js', 'rb') as f:
    c = f.read().decode('utf-8', errors='replace')

start = c.find('// \u2500\u2500 POST /upload')
end = c.find('// \u2500\u2500 GET /jobs')

new_route = """// \u2500\u2500 POST /upload (busboy) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
router.post("/upload", async (req, res) => {
  const MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE || "52428800", 10);
  const jobId = uuidv4();
  const userId = req.session.user.id;
  const formFields = {};
  const tmpDir = await fsp.mkdtemp(os.tmpdir() + "/logsystem-upload-");
  let responded = false, filename = null, fileSize = 0, tmpFile = null;
  const safeRespond = (status, body) => { if (!responded) { responded = true; res.status(status).json(body); } };
  try {
    const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_SIZE, files: 1 } });
    bb.on("field", (name, val) => { formFields[name] = val; });
    bb.on("file", (fieldname, fileStream, info) => {
      filename = info.filename || "upload";
      const ext = filename.split(".").pop().toLowerCase();
      const allowed = ["log","txt","json","jsonl","csv","xml","zip","gz","gzip","tar","tgz","rar","7z"];
      if (!allowed.includes(ext)) { fileStream.resume(); return safeRespond(400, { error: "Extension non supportee: " + ext }); }
      tmpFile = tmpDir + "/" + jobId + "." + ext;
      const ws = createWriteStream(tmpFile);
      const hasher = createHash("sha256");
      fileStream.on("data", chunk => { fileSize += chunk.length; hasher.update(chunk); });
      fileStream.on("limit", () => { ws.destroy(); fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); safeRespond(413, { error: "Fichier trop volumineux" }); });
      fileStream.pipe(ws);
      ws.on("finish", async () => {
        if (responded) return;
        const fileHash = hasher.digest("hex");
        const source = formFields.source || null;
        const service = formFields.service || null;
        const locale = formFields.locale || null;
        try {
          await pool.execute(
            "INSERT INTO import_jobs (id, filename, file_size, file_hash, import_ip_address, user_id, import_source, import_service) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [jobId, filename, fileSize, fileHash, req.ip, userId, source, service]
          );
          safeRespond(200, { job_id: jobId, filename });
          fsp.readFile(tmpFile)
            .then(buffer => processImport(jobId, buffer, filename, userId, source, service, locale))
            .catch(e => logger.error({ event: "import_fatal", jobId, error: e.message }, "[IMPORT]"))
            .finally(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}));
          await recordAudit({ userId, userEmail: req.session.user.email, action: "import_upload", resourceType: "import_job", resourceId: jobId, details: { file: filename, size: fileSize, hash: fileHash }, ipAddress: req.ip });
        } catch (e) {
          logger.error({ event: "upload_db_error", error: e.message }, "[IMPORT]");
          safeRespond(500, { error: e.message || "Erreur upload" });
          fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      });
      ws.on("error", e => { safeRespond(500, { error: "Erreur ecriture: " + e.message }); fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); });
    });
    bb.on("error", e => safeRespond(400, { error: "Erreur upload: " + e.message }));
    bb.on("finish", () => { if (!filename && !responded) safeRespond(400, { error: "Aucun fichier fourni" }); });
    req.pipe(bb);
  } catch (e) {
    logger.error({ event: "upload_error", error: e.message }, "[IMPORT]");
    safeRespond(500, { error: e.message || "Erreur upload" });
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

"""

if start != -1 and end != -1:
    result = c[:start] + new_route + c[end:]
    with open('routes/import.js', 'wb') as f:
        f.write(result.encode('utf-8'))
    print('OK: route remplacee')
else:
    print('ERREUR: markers not found', start, end)
