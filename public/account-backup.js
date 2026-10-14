(() => {
  document.addEventListener("DOMContentLoaded",()=>{
    const panel=document.querySelector("[data-account-backup]");
    if(!panel) return;
    const find=name=>panel.querySelector(`[data-backup-${name}]`);
    const status=find("status"), preview=find("preview"), input=find("file"), confirm=find("confirm"), restore=find("restore"), create=find("create");
    let token="", busy=false;
    const csrf=document.querySelector('input[name="_csrf"]')?.value;
    async function request(route,body) {
      const response=await fetch(`/account-backup/${route}`,{method:body?"POST":"GET",cache:"no-store",headers:body?{"Content-Type":"application/json"}:{},...(body?{body:JSON.stringify({...body,_csrf:csrf})}:{})});
      if(!response.headers.get("content-type")?.includes("application/json")) throw new Error("Session expirée ou requête refusée. Rechargez la page.");
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || "L’opération a échoué.");
      return data;
    }
    function clearPreview(){token="";preview.hidden=true;confirm.value="";restore.disabled=true;}
    function lock(value){busy=value;create.disabled=value;input.disabled=value;restore.disabled=value || !token || confirm.value!=="RESTAURER";}
    async function refresh(){
      const data=await request("status");
      find("list").replaceChildren();
      status.textContent=data.backups.length?`Dernière copie sur le serveur : ${new Date(data.backups[0].createdAt).toLocaleString("fr-FR")}`:"Aucune sauvegarde du compte disponible sur ce serveur.";
      for(const backup of data.backups){
        const item=document.createElement("li"),link=document.createElement("a");
        link.href=`/account-backup/download/${encodeURIComponent(backup.name)}`;
        link.textContent=`Télécharger ${backup.rollback?"le retour arrière":"la sauvegarde"} du ${new Date(backup.createdAt).toLocaleString("fr-FR")}`;
        item.append(link);find("list").append(item);
      }
    }
    create.addEventListener("click",async()=>{
      if(busy)return;lock(true);
      try{await request("create",{});await refresh();}catch(error){status.textContent=error.message;}finally{lock(false);}
    });
    input.addEventListener("change",async()=>{
      clearPreview();const file=input.files[0];if(!file || busy)return;
      if(file.size>5*1024*1024){status.textContent="Fichier trop volumineux : maximum 5 Mo.";return;}
      lock(true);
      try{
        const data=await request("preview",{backup:JSON.parse(await file.text())});
        token=data.token;find("warning").textContent=data.message;
        const describe=s=>`${s.clients} clients (dont ${s.archivedClients} archivés), ${s.entries} journées, ${s.salaries} salaires\nDates : ${s.firstDate || "aucune"} → ${s.lastDate || "aucune"}`;
        find("summary").textContent=`Actuellement\n${describe(data.current)}\n\nAprès restauration\n${describe(data.incoming)}`;
        preview.hidden=false;status.textContent="Aperçu prêt. Aucune donnée modifiée. Valable 10 minutes.";
      }catch(error){status.textContent=error instanceof SyntaxError?"Le fichier JSON est invalide.":error.message;}finally{lock(false);input.value="";}
    });
    confirm.addEventListener("input",()=>{restore.disabled=busy || !token || confirm.value!=="RESTAURER";});
    find("cancel").addEventListener("click",()=>{if(!busy)clearPreview();});
    restore.addEventListener("click",async()=>{
      if(busy || !token || confirm.value!=="RESTAURER")return;lock(true);
      try{await request("restore",{token,confirm:confirm.value});clearPreview();location.assign("/");}
      catch(error){clearPreview();status.textContent=error.message;lock(false);}
    });
    refresh().catch(error=>{status.textContent=error.message;});
  });
})();
