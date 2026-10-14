const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ownerKey, digest, validateBackup, summary, envelope } = require("../services/account-backup");
function createAccountBackupRouter(db, directory = process.env.ACCOUNT_BACKUP_DIR || path.resolve(__dirname, "../data/account-backups")) {
  const router = express.Router();
  const previews = new Map();
  const folder = user => path.join(directory, ownerKey(user));
  function preserve(user, data, kind = "manual") {
    const file = envelope(user, data);
    const contents = JSON.stringify(file);
    if (Buffer.byteLength(contents) > 5 * 1024 * 1024) { const error = new Error("Le compte dépasse la limite de sauvegarde de 5 Mo. Aucune donnée modifiée."); error.status=413; throw error; }
    const destination = folder(user);
    fs.mkdirSync(destination,{recursive:true,mode:0o700});
    const name = `${Date.now()}-${kind}-${crypto.randomUUID()}.json`;
    const finalPath = path.join(destination,name);
    const temp = `${finalPath}.tmp`;
    const descriptor = fs.openSync(temp,"wx",0o600);
    try { fs.writeFileSync(descriptor,contents); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    if (digest(JSON.parse(fs.readFileSync(temp,"utf8"))) !== digest(file)) throw new Error("La sauvegarde n’a pas pu être vérifiée.");
    fs.renameSync(temp,finalPath);
    return { file, name };
  }
  router.use((req,res,next)=>{
    res.set("Cache-Control","no-store");
    if (!req.authUser) return res.status(401).json({error:"Connexion requise."});
    next();
  });
  router.get("/status",(req,res)=>{
    let names=[];
    try { names=fs.readdirSync(folder(req.authUser)).filter(n=>/^\d+-(manual|before-restore)-[a-f0-9-]+\.json$/.test(n)).sort().reverse().slice(0,10); }
    catch(error){ if(error.code !== "ENOENT") throw error; }
    res.json({ backups:names.map(name=>({name,createdAt:new Date(Number(name.split("-")[0])).toISOString(),rollback:name.includes("before-restore")})) });
  });
  router.get("/download/:name",(req,res)=>{
    if (!/^\d+-(manual|before-restore)-[a-f0-9-]+\.json$/.test(req.params.name)) return res.status(400).json({error:"Fichier invalide."});
    res.download(path.join(folder(req.authUser),req.params.name),"timehours-compte.json");
  });
  router.post("/create",async(req,res)=>{
    const data = await db.getAccountSnapshot(req.authUser);
    validateBackup(envelope(req.authUser,data),req.authUser);
    const saved = preserve(req.authUser,data);
    res.json({ name:saved.name, summary:summary(data), createdAt:saved.file.createdAt });
  });
  router.post("/preview",async(req,res)=>{
    for(const [user,item] of previews) if(item.expiresAt < Date.now()) previews.delete(user);
    if(previews.size >= 20 && !previews.has(req.authUser)) return res.status(429).json({error:"Trop d’aperçus en cours. Réessayez plus tard."});
    const data = validateBackup(req.body.backup,req.authUser);
    const current = await db.getAccountSnapshot(req.authUser);
    const token = crypto.randomUUID();
    previews.set(req.authUser,{token,data,expectedDigest:digest(current),expiresAt:Date.now()+10*60*1000});
    res.json({token,current:summary(current),incoming:summary(data),message:"Remplacement de tous les clients, journées, salaires et réglages du compte. Une sauvegarde de retour arrière sera conservée. Les identifiants clients seront renouvelés."});
  });
  router.post("/restore",async(req,res)=>{
    const preview = previews.get(req.authUser);
    if(!preview || preview.token !== req.body.token || preview.expiresAt < Date.now() || req.body.confirm !== "RESTAURER") return res.status(409).json({error:"Aperçu expiré ou confirmation manquante."});
    previews.delete(req.authUser);
    const timer = (await db.getWorkTimer(req.authUser)).state;
    if (timer && timer.end === null) return res.status(409).json({error:"Terminez ou annulez le chronomètre avant la restauration."});
    const data = await db.restoreAccountSnapshot(req.authUser,preview.data,preview.expectedDigest,before=>preserve(req.authUser,before,"before-restore"));
    res.json({restored:true,summary:summary(data)});
  });
  router.use((error,req,res,next)=>{
    res.status(error.status || 500).json({error:error.status ? error.message : "L’opération a échoué. Aucune restauration n’a été validée. Réessayez ou vérifiez le stockage du serveur."});
  });
  return router;
}
module.exports = { createAccountBackupRouter };
