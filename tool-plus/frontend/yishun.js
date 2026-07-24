(function bootstrapYishun(){
  'use strict';
  const officialModels=Array.from(window.YISHUN_MODELS||[]);
  let customModels=[];
  const allModels=()=>[...customModels,...officialModels];
  const fallback={
    canvasModelConfigGet:async()=>({ok:true,profiles:{image:{configured:false,baseURL:'https://api.tmlab.store',model:'nano-banana-pro(特价版1)'},video:{configured:false,baseURL:'https://api.tmlab.store',model:'seedance-2.0-pro(431)'}}}),
    canvasModelConfigSave:async payload=>({ok:true,profiles:payload.profiles}),
    canvasImageGenerate:async()=>({ok:false,error:'请在衣瞬桌面客户端中运行图片生成。'}),
    canvasVideoGenerate:async()=>({ok:false,error:'请在衣瞬桌面客户端中运行视频生成。'}),
    canvasGenerationCancel:async()=>({ok:true}),onCanvasGenerationProgress:()=>()=>{},
    modelLibraryList:async()=>({ok:true,models:[]}),
    modelLibraryRead:async()=>({ok:false,error:'静态预览无法读取用户模特。'}),
    modelLibraryCreate:async()=>({ok:false,error:'请通过衣瞬 Web 服务或桌面客户端管理模特。'}),
    modelLibraryUpdate:async()=>({ok:false,error:'请通过衣瞬 Web 服务或桌面客户端管理模特。'}),
    modelLibraryDelete:async()=>({ok:false,error:'请通过衣瞬 Web 服务或桌面客户端管理模特。'})
  };
  const api=window.toolplus||window.yishunWebApi||fallback;
  const hostMode=window.toolplus?'electron':window.yishunWebApi?'web':'static';
  const state={filter:'all',query:'',scrollTop:0,model:null,immersive:true,noticeTimer:0,ignoreHash:false};
  const $=selector=>document.querySelector(selector);
  const gallery=$('#galleryView'),tryon=$('#tryonView'),doubleCommercial=$('#doubleCommercialView'),canvas=$('#canvasView'),frame=$('#canvasFrame'),grid=$('#modelGrid'),empty=$('#modelEmpty'),search=$('#modelSearch'),notice=$('#noticeBar');
  const svg=id=>`<svg aria-hidden="true"><use href="#${id}"></use></svg>`;
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

  function toast(message,tone='info'){
    clearTimeout(state.noticeTimer);notice.textContent=message;notice.dataset.tone=tone;notice.hidden=false;
    state.noticeTimer=setTimeout(()=>{notice.hidden=true},3600);
  }
  window.yishunToast=toast;
  function activeNav(name){document.querySelectorAll('.sideItem').forEach(button=>button.classList.toggle('active',button.dataset.nav===name))}
  function filtered(){const q=state.query.trim().toLowerCase();return allModels().filter(model=>(state.filter==='all'||(state.filter==='custom'?model.source==='custom':model.gender===state.filter||model.style===state.filter))&&(!q||`${model.name} ${model.id} ${model.tag} ${model.meta} ${model.region||''} ${model.ageGroup||''}`.toLowerCase().includes(q)))}
  function modelCard(model){
    const custom=model.source==='custom',id=escapeHTML(model.id),name=escapeHTML(model.name),tag=escapeHTML(model.tag||'模特'),meta=escapeHTML(model.meta||''),image=escapeHTML(model.image||'');
    const manage=custom?`<div class="modelManageActions"><button type="button" data-model-edit="${id}" title="编辑模特" aria-label="编辑${name}">${svg('i-edit')}</button><button type="button" data-model-delete="${id}" title="删除模特" aria-label="删除${name}">${svg('i-trash')}</button></div>`:'';
    const visual=image?`<img src="${image}" alt="${name}，${tag}" loading="lazy">`:`<div class="modelImagePlaceholder">${svg('i-users')}</div>`;
    return `<article class="modelCard${custom?' is-custom':''}" data-model-id="${id}"><div class="modelVisual">${visual}<span class="modelBadge">${tag}</span>${manage}<button class="modelAction" data-create="${id}">进入创作 ${svg('i-arrow')}</button></div><div class="modelInfo"><div><h3>${name}</h3><p>${meta}</p></div><span class="modelCode">${custom?'MY':id}</span></div></article>`;
  }
  function render(){
    const visible=filtered();
    grid.innerHTML=visible.map(modelCard).join('');
    grid.hidden=!visible.length;empty.hidden=Boolean(visible.length);$('#modelCount').textContent=String(visible.length);
    const customEmpty=!visible.length&&state.filter==='custom'&&!state.query.trim(),emptyButton=$('#resetFilterBtn');
    empty.querySelector('strong').textContent=customEmpty?'还没有我的模特':'没有找到匹配的模特';
    empty.querySelector('span').textContent=customEmpty?'上传照片和信息，建立自己的专属模特库。':'调整关键词或切换筛选条件。';
    emptyButton.textContent=customEmpty?'新增第一个模特':'查看全部模特';emptyButton.dataset.action=customEmpty?'add':'reset';
  }
  function resetFilters(){state.filter='all';state.query='';search.value='';document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',button.dataset.filter==='all'));render()}
  function setImmersive(enabled){
    state.immersive=Boolean(enabled);document.body.classList.toggle('canvasImmersiveMode',state.immersive&&!canvas.hidden);
    const button=$('#canvasImmersiveBtn');button.setAttribute('aria-pressed',String(state.immersive));button.querySelector('span').textContent=state.immersive?'显示导航':'沉浸模式';
    if(frame.dataset.loaded==='true')requestAnimationFrame(()=>{try{frame.contentWindow.dispatchEvent(new Event('resize'))}catch(_){}});
  }
  function updateHash(route){
    if(location.hash===`#${route}`)return;state.ignoreHash=true;location.hash=route;
  }
  function openGallery(section='home',updateLocation=true){
    setImmersive(false);canvas.hidden=true;tryon.hidden=true;doubleCommercial.hidden=true;gallery.hidden=false;activeNav(section);
    requestAnimationFrame(()=>gallery.scrollTo({top:section==='models'?$('#modelsSection').offsetTop-18:0,behavior:'smooth'}));
    if(updateLocation)updateHash(section);
  }
  function openTryon(updateLocation=true){
    if(!gallery.hidden)state.scrollTop=gallery.scrollTop;
    setImmersive(false);canvas.hidden=true;doubleCommercial.hidden=true;gallery.hidden=true;tryon.hidden=false;activeNav('tryon');
    window.yishunTryon?.open();if(updateLocation)updateHash('tryon');
  }
  function openDoubleCommercial(updateLocation=true){
    if(!gallery.hidden)state.scrollTop=gallery.scrollTop;
    setImmersive(false);canvas.hidden=true;gallery.hidden=true;tryon.hidden=true;doubleCommercial.hidden=false;activeNav('double-commercial');
    window.yishunDoubleCommercial?.open();if(updateLocation)updateHash('double-commercial');
  }
  function openCanvas(options={},updateLocation=true){
    if(!gallery.hidden)state.scrollTop=gallery.scrollTop;state.model=options.model||null;$('#canvasTitle').textContent=`智能画布${state.model?' · '+state.model.name:''}`;
    tryon.hidden=true;doubleCommercial.hidden=true;gallery.hidden=true;canvas.hidden=false;activeNav('canvas');setImmersive(true);
    if(frame.dataset.loaded!=='true'){frame.dataset.loaded='true';frame.src=frame.dataset.src;$('#canvasStatus').textContent='画布加载中'}
    if(updateLocation)updateHash('canvas');requestAnimationFrame(()=>$('#canvasBackBtn').focus());
  }
  function returnCanvas(updateHash=true){
    openGallery('models',updateHash);requestAnimationFrame(()=>{gallery.scrollTop=state.scrollTop});
  }
  const profile=(response,key)=>response?.profiles?.[key]||(key==='image'?response?.image||response||{}:response?.video||{});
  const normalizeAPIKey=value=>String(value||'').trim().replace(/^Bearer(?:\s+|$)/i,'').trim();
  async function openSettings(){
    const dialog=$('#settingsDialog');dialog.showModal();$('#imageConfigState').textContent='读取中';$('#videoConfigState').textContent='读取中';
    try{const response=await api.canvasModelConfigGet();if(response?.ok===false)throw new Error(response.error||'无法读取设置');const image=profile(response,'image'),video=profile(response,'video');
      $('#canvasImageBaseURL').value=image.baseURL||'';$('#canvasImageModel').value=image.model||'';$('#canvasVideoBaseURL').value=video.baseURL||'';$('#canvasVideoModel').value=video.model||'';$('#canvasModelApiKey').value='';$('#canvasVideoModelApiKey').value='';$('#imageConfigState').textContent=image.configured?'已安全配置':'尚未配置密钥';$('#videoConfigState').textContent=video.configured?'已安全配置':'尚未配置密钥';
    }catch(error){toast(error.message||String(error),'error')}
  }
  async function saveSettings(event){
    if(event.submitter?.value==='cancel')return;event.preventDefault();
    const payload={profiles:{image:{baseURL:$('#canvasImageBaseURL').value.trim(),model:$('#canvasImageModel').value.trim(),apiKey:normalizeAPIKey($('#canvasModelApiKey').value)},video:{baseURL:$('#canvasVideoBaseURL').value.trim(),model:$('#canvasVideoModel').value.trim(),apiKey:normalizeAPIKey($('#canvasVideoModelApiKey').value)}}};
    try{const response=await api.canvasModelConfigSave(payload);if(!response||response.ok===false)throw new Error(response?.error||'保存失败');$('#settingsDialog').close();toast('模型设置已安全保存。','success')}catch(error){toast(error.message||String(error),'error')}
  }

  $('#greeting').textContent=new Date().getHours()<11?'早上好':new Date().getHours()<14?'中午好':new Date().getHours()<19?'下午好':'晚上好';
  $('#homeBtn').onclick=()=>openGallery('home');
  $('#settingsBtn').onclick=openSettings;$('#helpBtn').onclick=()=>$('#helpDialog').showModal();$('#settingsForm').addEventListener('submit',saveSettings);$('#resetFilterBtn').onclick=event=>event.currentTarget.dataset.action==='add'?window.yishunModelManagement?.openCreate():resetFilters();
  $('#canvasBackBtn').onclick=()=>returnCanvas();$('#tryonBackBtn').onclick=()=>openGallery('home');$('#doubleCommercialBackBtn').onclick=()=>openGallery('home');$('#canvasImmersiveBtn').onclick=()=>setImmersive(!state.immersive);frame.addEventListener('load',()=>{if(frame.dataset.loaded==='true'){ $('#canvasStatus').textContent='画布已就绪';frame.contentWindow.postMessage({type:'yishun:host-mode',mode:hostMode},'*')}});
  search.addEventListener('input',event=>{state.query=event.target.value;render()});
  $('.filterTabs').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;state.filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>item.classList.toggle('active',item===button));render()});
  grid.addEventListener('click',event=>{
    const edit=event.target.closest('[data-model-edit]');if(edit){window.yishunModelManagement?.openEdit(edit.dataset.modelEdit);return}
    const remove=event.target.closest('[data-model-delete]');if(remove){window.yishunModelManagement?.requestDelete(remove.dataset.modelDelete);return}
    const button=event.target.closest('[data-create]');if(button)openCanvas({model:allModels().find(model=>model.id===button.dataset.create)})
  });
  window.addEventListener('yishun:model-library-changed',event=>{customModels=Array.isArray(event.detail?.models)?event.detail.models:[];render()});
  document.querySelectorAll('[data-workflow]').forEach(button=>button.addEventListener('click',()=>button.dataset.workflow==='tryon'?openTryon():openCanvas({workflow:button.dataset.workflow})));
  document.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>{const route=button.dataset.nav;if(route==='canvas'){openCanvas();return}if(route==='tryon'){openTryon();return}if(route==='double-commercial'){openDoubleCommercial();return}openGallery(route==='models'?'models':'home')}));
  gallery.addEventListener('scroll',()=>{if(!gallery.hidden)activeNav(gallery.scrollTop>280?'models':'home')},{passive:true});
  window.addEventListener('hashchange',()=>{if(state.ignoreHash){state.ignoreHash=false;return}const route=location.hash.slice(1);if(route==='canvas'){openCanvas({},false);return}if(route==='tryon'){openTryon(false);return}if(route==='double-commercial'){openDoubleCommercial(false);return}openGallery(route==='models'?'models':'home',false)});
  window.addEventListener('message',async event=>{
    if(!frame.contentWindow||event.source!==frame.contentWindow)return;const message=event.data;
    if(message?.type==='toolplus:canvas-cancel'&&message.requestId){await api.canvasGenerationCancel(message.requestId);return}
    if(!message||message.type!=='toolplus:canvas-request'||!message.requestId)return;let result;
    try{const payload={...(message.payload||{}),_requestId:message.requestId};if(message.action==='image.generate')result=await api.canvasImageGenerate(payload);else if(message.action==='video.generate')result=await api.canvasVideoGenerate(payload);else if(message.action==='model.config.get')result=await api.canvasModelConfigGet();else result={ok:false,error:`不支持的画布请求：${message.action}`}}catch(error){result={ok:false,error:error.message||String(error)}}
    frame.contentWindow.postMessage({type:'toolplus:canvas-response',requestId:message.requestId,result},'*');
  });
  api.onCanvasGenerationProgress?.(progress=>{if(frame.contentWindow&&progress?.requestId)frame.contentWindow.postMessage({type:'toolplus:canvas-progress',...progress},'*')});
  async function updateServiceStatus(){const indicator=$('#serviceIndicator'),label=$('#serviceStatus');if(hostMode==='electron'){label.textContent='客户端模式';return}if(hostMode==='static'){label.textContent='仅静态预览';indicator.classList.add('is-error');return}try{const response=await fetch('/api/health',{headers:{Accept:'application/json'}});const health=await response.json();if(!response.ok||!health.ok)throw new Error();label.textContent='Web 服务已连接';indicator.classList.remove('is-error')}catch(_){label.textContent='Web 服务未连接';indicator.classList.add('is-error')}}
  updateServiceStatus();render();window.yishunModelManagement?.refresh().catch(error=>toast(error.message||String(error),'error'));if(location.hash==='#canvas')openCanvas({},false);else if(location.hash==='#tryon')openTryon(false);else if(location.hash==='#double-commercial')openDoubleCommercial(false);else if(location.hash==='#models')openGallery('models',false);
})();
