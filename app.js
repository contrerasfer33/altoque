(function(){
  var TYPE_STYLE = [
    { c:'#C8101C', s:'#FCDDDF', short:'Atraso' },
    { c:'#1537C9', s:'#DFE5FB', short:'Celular' },
    { c:'#7A5E00', s:'#FFF1A8', short:'Fuera de sala' }
  ];
  var state = { courses:[], records:[], tipos:[], mail:{}, currentUser:{}, appUrl:'', selectedCourseId:null, currentTipo:null, unlocked:false,
                salidas:[], exitCfg:{ motivos:[], sinAlerta:[], minAlerta:15, minAuto:5 }, liveVer:'', counter:null, clockOffset:0, snooze:{}, knownAlarms:{}, knownEnf:{}, knownReturn:{}, docentes:[], exitScreenOpen:false, enfScreenOpen:false };
  function $(id){ return document.getElementById(id); }
  // ---------- conexión con el servidor (Supabase) ----------
  var CFG = window.ALTOQUE_CONFIG || {};
  var sb = (window.supabase && CFG.supabaseUrl && CFG.supabaseKey && !window.ALTOQUE_MOCK)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } })
    : null;
  function cleanErr(msg){ return String(msg || 'Error desconocido').replace(/^.*?ERROR:\s*/, ''); }
  function rpc(name, params){
    if(!sb) return Promise.reject(new Error('Falta configurar la conexión (config.js).'));
    return sb.rpc(name, params || {}).then(function(r){
      if(r.error) throw new Error(cleanErr(r.error.message));
      return r.data;
    });
  }
  var API = {
    getBootstrapData: function(force){ return rpc('get_bootstrap', { p_force:!!force }); },
    getLive: function(v){ return rpc('get_live', { p_ver:v || '' }); },
    registrar: function(cid, cn, sid, sn, tipo){ return rpc('registrar', { p_student:sid, p_tipo:tipo }); },
    undoRecord: function(id){ return rpc('undo_record', { p_id:id }); },
    autorizarSalida: function(sid, m){ return rpc('autorizar_salida', { p_student:sid, p_motivo:m }); },
    marcarRegreso: function(id){ return rpc('marcar_regreso', { p_id:id }); },
    reportarNoRegreso: function(id){ return rpc('reportar_no_regreso', { p_id:id }); },
    enfLlego: function(id){ return rpc('enf_llego', { p_id:id }); },
    enfNoLlego: function(id){ return rpc('enf_no_llego', { p_id:id }); },
    enfAtendido: function(id, d){ return rpc('enf_atendido', { p_id:id, p_docente:d || '' }); },
    enfRetirado: function(id){ return rpc('enf_retirado', { p_id:id }); },
    startSession: function(){ return rpc('start_session', {}); },
    pulseSession: function(id, s, c){ return rpc('pulse_session', { p_id:id, p_secs:Math.round(s || 0), p_cierre:c || '' }); },
    addCourse: function(n){ return rpc('add_course', { p_name:n }); },
    deleteCourse: function(id){ return rpc('delete_course', { p_id:id }); },
    addStudents: function(cid, t){ return rpc('add_students', { p_course:cid, p_text:t }); },
    setGuardianEmail: function(sid, t){ return rpc('set_guardian_email', { p_student:sid, p_text:t }); },
    setStudentEmail: function(sid, t){ return rpc('set_student_email', { p_student:sid, p_text:t }); },
    removeStudent: function(id){ return rpc('remove_student', { p_id:id }); },
    getUsageData: function(){ return rpc('get_usage_data', {}); },
    archivarRegistros: function(){ return rpc('proximamente', {}); },
    getCounterSettings: function(){ return rpc('proximamente', {}); },
    saveCounterSettings: function(){ return rpc('proximamente', {}); },
    resetCounters: function(){ return rpc('proximamente', {}); }
  };
  function runServer(fnName){
    var args = Array.prototype.slice.call(arguments, 1);
    if(window.ALTOQUE_MOCK){
      return new Promise(function(resolve, reject){
        var runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
        runner[fnName].apply(runner, args);
      });
    }
    var f = API[fnName];
    if(!f) return Promise.reject(new Error('Función no disponible: '+fnName));
    return f.apply(null, args);
  }
  function signInGoogle(){
    if(!sb){ toast('Falta configurar la conexión (config.js).', true); return; }
    sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin + location.pathname, queryParams:{ prompt:'select_account' } } })
      .then(function(r){ if(r.error) toast('No se pudo iniciar sesión: '+r.error.message, true); });
  }
  function signOutAndSwitch(){
    if(!sb) return;
    sb.auth.signOut().then(signInGoogle, signInGoogle);
  }
  function errText(err){ return (err && err.message) ? err.message : String(err); }
  var toastTimer;
  function toast(msg, isErr){
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.className = 'toast hidden'; }, isErr ? 6000 : 2500);
  }
  function pad2(n){ return String(n).padStart(2,'0'); }
  function todayStr(){ var d = new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
  function monthStart(){ var d = new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-01'; }
  function escapeHtml(str){ var d = document.createElement('div'); d.textContent = str == null ? '' : str; return d.innerHTML; }
  function typeIndex(t){ var i = state.tipos.indexOf(t); return i < 0 ? 0 : i; }
  function styleOf(t){ return t === '__salida' ? { c:'#0E7A3E', s:'#DDF3E6', short:'Salida' } : TYPE_STYLE[typeIndex(t) % TYPE_STYLE.length]; }
  function tagHtml(t){ var st = styleOf(t); return '<span class="tag" style="--c:'+st.c+';--cs:'+st.s+'">'+escapeHtml(st.short)+'</span>'; }
  function canUndo(r){
    return !!state.currentUser.isAdmin || String(r.by||'').toLowerCase() === String(state.currentUser.email||'').toLowerCase();
  }
  function currentCourse(){ return state.courses.find(function(c){ return c.id === state.selectedCourseId; }); }
  function ensureSelection(){
    if(state.selectedCourseId && !currentCourse()) state.selectedCourseId = null;
    if(!state.selectedCourseId && state.courses.length) state.selectedCourseId = state.courses[0].id;
  }
  function applyData(data){
    if(!data) throw new Error('El servidor no devolvió datos.');
    state.courses = data.courses || [];
    state.records = data.records || [];
    state.tipos = data.tipos || [];
    state.mail = data.mail || {};
    state.idleMinutes = data.idleMinutes || 5;
    state.currentUser = data.currentUser || {};
    state.mailToday = data.mailToday || null;
    state.appUrl = data.appUrl || '';
    state.salidas = data.salidas || [];
    if(data.exitCfg) state.exitCfg = data.exitCfg;
    if(data.counter) state.counter = data.counter;
    state.docentes = data.docentes || [];
    if(data.liveVer) state.liveVer = data.liveVer;
    if(data.serverTime) setClock(data.serverTime);
    seedKnownAlarms();
    if(!state.currentTipo || (state.currentTipo !== '__salida' && state.tipos.indexOf(state.currentTipo) < 0)) state.currentTipo = state.tipos[0];
  }
  function refreshData(quiet){
    return runServer('getBootstrapData', !quiet).then(function(data){
      applyData(data);
      renderAll();
      if(!quiet) toast('Datos actualizados');
    }).catch(function(err){ if(!quiet) toast('No se pudo actualizar: '+errText(err), true); });
  }
  function initials(name){
    return String(name||'?').split(/[\s@.]+/).filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
  }
  function showEntry(reason){
    if(state.unlocked && session.id){ sendPulse(typeof reason === 'string' ? reason : 'Salir'); session.id = null; }
    state.unlocked = false;
    clearTimeout(idleTimer);
    closeAllModals();
    if(state.exitScreenOpen) closeExitScreen();
    if(state.enfScreenOpen) closeEnfScreen();
    $('overlayExit').classList.add('hidden'); $('overlayOverdue').classList.add('hidden'); $('overlayTeacher').classList.add('hidden'); overdue.id = null;
    if(reason === 'Inactividad'){
      $('entryMsg').textContent = 'La sesión se bloqueó tras '+(state.idleMinutes||5)+' minutos sin uso. Vuelve a ingresar para continuar.';
      $('entryMsg').className = 'entry-msg';
    } else if(state.currentUser && state.currentUser.email){
      $('entryMsg').textContent = 'Confirma que esta es tu cuenta para continuar.';
      $('entryMsg').className = 'entry-msg';
    }
    $('app').classList.add('hidden');
    $('entry').classList.remove('hidden');
  }
  function fillEntry(){
    var u = state.currentUser;
    $('entryAvatar').textContent = initials(u.name || u.email);
    $('entryName').textContent = u.name || u.email;
    $('entryEmail').textContent = u.email;
    $('entryAccount').classList.remove('hidden');
    $('entryMsg').textContent = 'Confirma que esta es tu cuenta para continuar.';
    $('entryMsg').className = 'entry-msg';
    $('btnEnter').disabled = false;
    var sw = $('switchAccount');
    sw.href = '#';
    sw.onclick = function(e){ e.preventDefault(); signOutAndSwitch(); };
    sw.classList.remove('hidden');
    $('btnGoogle').classList.add('hidden');
    $('btnEnter').classList.remove('hidden');
  }
  function showLogin(msg, isErr){
    $('entryAccount').classList.add('hidden');
    $('btnEnter').classList.add('hidden');
    $('btnGoogle').classList.remove('hidden');
    $('entryMsg').textContent = msg || 'Ingresa con tu cuenta Google del colegio.';
    $('entryMsg').className = 'entry-msg' + (isErr ? ' err' : '');
    var sw = $('switchAccount');
    sw.classList.add('hidden');
  }
  $('btnGoogle').onclick = signInGoogle;
  var session = { id:null, activeSec:0, lastInteract:0 };
  function sendPulse(cierre){
    if(!session.id) return;
    runServer('pulseSession', session.id, session.activeSec, cierre || '').catch(function(){});
  }
  $('btnEnter').onclick = function(){
    state.unlocked = true;
    $('entry').classList.add('hidden');
    $('app').classList.remove('hidden');
    renderAll();
    resetIdle();
    session.id = null; session.activeSec = 0; session.lastInteract = Date.now();
    runServer('startSession').then(function(id){ session.id = id; }).catch(function(){});
    if(isEnfOnly()) openEnfScreen();
    pollLive();
  };
  $('btnLock').onclick = function(){ showEntry('Salir'); };
  var idleTimer;
  function resetIdle(){
    session.lastInteract = Date.now();
    if(!state.unlocked) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function(){ showEntry('Inactividad'); }, (state.idleMinutes || 5)*60*1000);
  }
  ['click','keydown','mousemove','touchstart','wheel'].forEach(function(ev){ document.addEventListener(ev, resetIdle, { passive:true }); });
  setInterval(function(){
    if(state.unlocked && session.id && document.visibilityState === 'visible' && Date.now() - session.lastInteract < 120000) session.activeSec += 15;
  }, 15000);
  setInterval(function(){ if(state.unlocked) sendPulse(''); }, 120000);
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden' && state.unlocked) sendPulse(''); });

  function renderActionSelect(){
    var sel = $('actionSelect');
    sel.innerHTML = '';
    state.tipos.forEach(function(t){
      var opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      if(t === state.currentTipo) opt.selected = true;
      sel.appendChild(opt);
    });
    var ox = document.createElement('option');
    ox.value = '__salida'; ox.textContent = 'Autorizar salida de la sala';
    if(isExitMode()) ox.selected = true;
    sel.appendChild(ox);
    var st = styleOf(state.currentTipo);
    $('actionBar').style.setProperty('--act', st.c);
    var note = $('mailNote');
    note.classList.remove('hidden');
    if(isExitMode()){
      note.className = 'mail-note exit';
      note.textContent = '🚪 Haz clic en el estudiante y elige el motivo. Todos los que vean el curso sabrán que está afuera. No se envía correo.';
    } else if(state.mail.testMode){
      note.className = 'mail-note test';
      note.textContent = '✉ Modo prueba: los avisos llegan a '+(state.mail.testEmail||'tu correo');
    } else {
      note.className = 'mail-note';
      note.textContent = '✉ Se envía aviso al apoderado y al estudiante';
    }
  }
  $('actionSelect').onchange = function(e){
    state.currentTipo = e.target.value;
    renderActionSelect();
    renderGrid();
  };
  function renderCourseTabs(){
    var wrap = $('courseTabs');
    wrap.innerHTML = '';
    state.courses.forEach(function(c){
      var b = document.createElement('button');
      b.className = 'course-tab' + (c.id === state.selectedCourseId ? ' active' : '');
      b.textContent = c.name;
      b.onclick = function(){ state.selectedCourseId = c.id; renderAll(); };
      wrap.appendChild(b);
    });
    if(!state.currentUser.isAdmin) return;
    var add = document.createElement('button');
    add.className = 'course-tab add';
    add.textContent = '+ Curso';
    add.onclick = openSettings;
    wrap.appendChild(add);
  }
  function renderGrid(){
    var area = $('gridArea');
    var course = currentCourse();
    if(!course){
      $('courseTitle').textContent = 'Sin cursos';
      $('courseCount').textContent = '';
      if(state.currentUser.isAdmin){
        area.innerHTML = '<div class="empty"><h3>Todavía no hay ningún curso</h3><p>Crea el primer curso y pega la lista de estudiantes.</p><button class="btn primary" id="emptyAddCourse">Agregar curso</button></div>';
        $('emptyAddCourse').onclick = openSettings;
      } else {
        area.innerHTML = '<div class="empty"><h3>Todavía no hay cursos cargados</h3><p>Un administrador de la plataforma debe agregar los cursos y sus estudiantes.</p></div>';
      }
      return;
    }
    $('courseTitle').textContent = course.name;
    $('courseCount').textContent = course.students.length + (course.students.length === 1 ? ' estudiante' : ' estudiantes');
    if(!course.students.length){
      if(state.currentUser.isAdmin){
        area.innerHTML = '<div class="empty"><h3>Este curso no tiene estudiantes todavía</h3><p>Pega la lista, uno por línea.</p><button class="btn primary" id="emptyAddStudents">Agregar estudiantes</button></div>';
        $('emptyAddStudents').onclick = openSettings;
      } else {
        area.innerHTML = '<div class="empty"><h3>Este curso no tiene estudiantes todavía</h3><p>Un administrador de la plataforma debe cargar la lista.</p></div>';
      }
      return;
    }
    var tipo = state.currentTipo;
    var st = styleOf(tipo);
    var today = todayStr();
    var month = today.slice(0,7);
    var grid = document.createElement('div');
    grid.className = 'grid';
    var exitMode = isExitMode();
    course.students.forEach(function(s){
      var ex = activeExit(s.id);
      if(exitMode){
        var nToday = state.salidas.filter(function(x){ return x.studentId === s.id; }).length;
        var cardX = document.createElement('div');
        cardX.className = 'student exitcard' + (ex ? ' is-out lvl-'+exitLevel(ex) : '');
        cardX.setAttribute('role','button');
        cardX.tabIndex = 0;
        cardX.style.setProperty('--c', st.c);
        cardX.style.setProperty('--cs', st.s);
        cardX.innerHTML =
          '<div class="name">'+escapeHtml(s.name)+'</div>' +
          (ex ? exitStripHtml(ex) : '') +
          '<div class="foot"><span class="status">'+(ex ? (canMarkBack(ex) ? 'Clic para marcar que volvió' : 'Lo atiende Enfermería') : 'En la sala · clic para autorizar salida')+'</span>' +
          '<span class="badge" title="Salidas de hoy">'+nToday+'</span></div>';
        var actX = function(ev){
          if(ex){
            if(String(ex.id).indexOf('tmp') === 0) return;
            if(!canMarkBack(ex)){ toast(s.name+' está '+(phaseOf(ex) === 'at' ? 'en enfermería' : 'camino a enfermería')+'. Enfermería lo despachará de vuelta.'); return; }
            if(ev.target.classList.contains('exit-back') || confirm('¿'+s.name+' volvió a la sala?')){ ev.stopPropagation(); doReturn(ex); }
            return;
          }
          openExitPicker(course, s);
        };
        cardX.onclick = actX;
        cardX.onkeydown = function(ev){ if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); actX(ev); } };
        grid.appendChild(cardX);
        return;
      }
      var mine = state.records.filter(function(r){ return r.studentId === s.id && r.tipo === tipo; });
      var todays = mine.filter(function(r){ return r.date === today; }).sort(function(a,b){ return a.time.localeCompare(b.time); });
      var last = todays[todays.length-1];
      var winCount = mine.filter(inCounterWindow).length;
      var rl = counterRule(tipo);
      var prog = rl.apo > 1 ? (winCount % rl.apo) : winCount;
      var badgeTxt = rl.apo > 1 ? prog+'/'+rl.apo : String(winCount);
      var nextSends = rl.apo > 0 && (rl.apo === 1 || prog === rl.apo - 1);
      var badgeTitle = winCount+' registro(s) de este tipo '+((state.counter && state.counter.label) || 'en el período')+'. ' +
        (rl.apo ? (rl.apo === 1 ? 'Se avisa al apoderado en cada registro.' : 'Se avisa al apoderado cada '+rl.apo+' registros'+(prog === rl.apo - 1 ? ': el próximo envía el aviso.' : '.')) : 'Aviso al apoderado desactivado.');
      var card = document.createElement('div');
      card.className = 'student' + (last ? ' marked' : '') + (ex ? ' is-out lvl-'+exitLevel(ex) : '');
      card.setAttribute('role','button');
      card.tabIndex = 0;
      card.style.setProperty('--c', st.c);
      card.style.setProperty('--cs', st.s);
      card.innerHTML =
        '<div class="name">'+escapeHtml(s.name)+'</div>' +
        (ex ? exitStripHtml(ex) : '') +
        ((!hg(s) || !hs(s)) ? '<div class="no-mail">Sin correo '+(!hg(s) && !hs(s) ? 'de apoderado ni estudiante' : (!hg(s) ? 'de apoderado' : 'del estudiante'))+'</div>' : '') +
        '<div class="foot"><span class="status">' +
          (last ? escapeHtml(st.short)+' · '+last.time+(todays.length>1 ? ' ('+todays.length+' hoy)' : '') : 'Sin registros hoy') +
        '</span><span class="badge'+(nextSends && rl.apo > 1 ? ' warn' : '')+'" title="'+escapeHtml(badgeTitle)+'">'+badgeTxt+'</span></div>' +
        (last && canUndo(last) ? '<button class="undo" type="button">Deshacer</button>' : '');
      function activate(ev){
        if(ev.target.classList.contains('exit-back')){ ev.stopPropagation(); doReturn(ex); return; }
        if(ev.target.classList.contains('undo')){ ev.stopPropagation(); doUndo(last.id); return; }
        if(last && !confirm(s.name+' ya tiene "'+tipo+'" hoy a las '+last.time+'.\n¿Registrar otro?')) return;
        doRegister(course, s, tipo, card);
      }
      card.onclick = activate;
      card.onkeydown = function(ev){ if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); activate(ev); } };
      grid.appendChild(card);
    });
    area.innerHTML = '';
    area.appendChild(grid);
  }
  function renderHistory(){
    var t = todayStr();
    var todays = state.records.filter(function(r){ return r.date === t; }).sort(function(a,b){ return b.time.localeCompare(a.time); });
    $('historySub').textContent = todays.length + (todays.length === 1 ? ' registro' : ' registros');
    var list = $('historyList');
    if(!todays.length){ list.innerHTML = '<div class="history-empty">Todavía no hay registros hoy.</div>'; return; }
    list.innerHTML = '';
    todays.forEach(function(r){
      var item = document.createElement('div');
      item.className = 'h-item';
      item.innerHTML =
        '<span class="h-time">'+r.time+'</span>' +
        '<span class="h-name">'+escapeHtml(r.studentName)+' '+tagHtml(r.tipo)+(r.tipo === state.tipos[0] && lateOf(r.time) && lateOf(r.time).late > 0 ? ' <span class="h-late">'+lateOf(r.time).late+' min tarde</span>' : '')+'<br><span class="h-course">'+escapeHtml(r.courseName)+'</span><br><span class="h-by">por '+escapeHtml(r.by||'')+(r.mailStatus ? '<br>✉ Apoderado: '+escapeHtml(r.mailStatus) : '')+(r.studentMailStatus ? '<br>✉ Estudiante: '+escapeHtml(r.studentMailStatus) : '')+'</span></span>' +
        (canUndo(r) ? '<button class="h-del" title="Eliminar registro">×</button>' : '');
      var del = item.querySelector('.h-del');
      if(del) del.onclick = function(){
        if(confirm('¿Eliminar este registro de '+r.studentName+'?\n\nSi ya se enviaron correos, no se pueden recuperar.')) doUndo(r.id);
      };
      list.appendChild(item);
    });
  }
  function renderAll(){
    ensureSelection();
    $('whoLabel').textContent = (state.currentUser.name || '') + (state.currentUser.email ? ' · '+state.currentUser.email : '') + (state.currentUser.role && state.currentUser.role !== 'Docente' ? ' · '+state.currentUser.role : '');
    $('btnAccess').classList.toggle('hidden', !state.currentUser.isAdmin);
    $('btnSettings').classList.toggle('hidden', !state.currentUser.isAdmin);
    renderMailChip();
    renderExitButton();
    renderEnfButton();
    if(state.exitScreenOpen) renderExitScreen();
    if(state.enfScreenOpen) renderEnfScreen();
    if(!state.currentUser.isAdmin) $('overlay').classList.add('hidden');
    $('adminNote').classList.toggle('hidden', !state.currentUser.isAdmin);
    renderActionSelect();
    renderCourseTabs();
    renderGrid();
    renderHistory();
  }
  function fmtNum(n, dec){ return Number(n||0).toLocaleString('es-CL', { maximumFractionDigits: dec==null ? 0 : dec }); }
  function renderMailChip(){
    var chip = $('mailChip');
    if(!chip) return;
    var m = state.mailToday;
    if(!state.currentUser.isAdmin || !m){ chip.classList.add('hidden'); return; }
    var q = m.quotaRemaining;
    chip.textContent = '✉ Hoy: '+fmtNum(m.total)+(q != null ? ' · cuota '+fmtNum(q) : '');
    chip.title = 'Correos enviados hoy por la plataforma'+(q != null ? '. Cuota disponible ahora: '+fmtNum(q)+' (tope diario de Google: '+fmtNum(m.limit||1500)+')' : '')+'. Detalle en Uso > Correos.';
    chip.classList.toggle('warn', q != null && q < (m.limit||1500) * 0.2);
    chip.classList.remove('hidden');
  }
  function countSent(status){ return /^(Enviado|Prueba enviada)/.test(status||'') ? 1 : 0; }
  function hg(s){ return state.currentUser.isAdmin ? !!s.guardianEmail : !!s.hasGuardian; }
  function hs(s){ return state.currentUser.isAdmin ? !!s.studentEmail : !!s.hasStudent; }
  function doRegister(course, student, tipo, cardEl){
    // Se muestra al instante; el servidor guarda y envía los correos en segundo plano.
    var tmp = { id:'tmp'+Date.now()+Math.floor(Math.random()*1000), date:todayStr(), time:nowHHMM(), courseId:course.id, courseName:course.name,
                studentId:student.id, studentName:student.name, by:state.currentUser.email, tipo:tipo,
                mailStatus:'Enviando…', studentMailStatus:'Enviando…', pending:true };
    state.records.push(tmp);
    renderAll();
    flashStudent(student.name);
    runServer('registrar', course.id, course.name, student.id, student.name, tipo).then(function(rec){
      state.records = state.records.filter(function(r){ return r.id !== tmp.id; });
      if(rec.duplicate){
        if(!state.records.some(function(r){ return r.id===rec.id; })) state.records.push(rec);
        renderAll();
        toast(student.name+' ya estaba registrado hace un momento. No se envió otro aviso.');
        return;
      }
      if(!state.records.some(function(r){ return r.id === rec.id; })) state.records.push(rec);
      else state.records = state.records.map(function(r){ return r.id === rec.id ? rec : r; });
      if(state.mailToday){
        var sent = countSent(rec.mailStatus) + countSent(rec.studentMailStatus);
        state.mailToday.total = (state.mailToday.total||0) + sent;
        if(state.mailToday.quotaRemaining != null) state.mailToday.quotaRemaining = Math.max(0, state.mailToday.quotaRemaining - sent);
      }
      renderAll();
      var ms = rec.mailStatus || '', se = rec.studentMailStatus || '';
      toast(student.name+' registrado · Apoderado: '+(ms||'—')+' · Estudiante: '+(se||'—'), /^Error/.test(ms) || /^Error/.test(se));
    }).catch(function(err){
      state.records = state.records.filter(function(r){ return r.id !== tmp.id; });
      renderAll();
      toast('No se pudo registrar a '+student.name+': '+errText(err), true);
    });
  }
  function flashStudent(name){
    var cards = $('gridArea').querySelectorAll('.student');
    cards.forEach(function(c){ var n = c.querySelector('.name'); if(n && n.textContent === name) c.classList.add('flash'); });
  }
  function doUndo(recordId){
    if(String(recordId).indexOf('tmp') === 0){ toast('Espera un segundo, el registro se está guardando.'); return; }
    runServer('undoRecord', recordId).then(function(){
      state.records = state.records.filter(function(r){ return r.id !== recordId; });
      renderAll();
      toast('Registro eliminado');
    }).catch(function(err){ toast('No se pudo deshacer: '+errText(err), true); });
  }
  $('btnRefresh').onclick = function(){ refreshData(false); };
  $('btnHistory').onclick = function(){ $('historyPanel').classList.toggle('collapsed'); };
  $('btnHistoryClose').onclick = function(){ $('historyPanel').classList.add('collapsed'); };
  if(window.matchMedia && window.matchMedia('(max-width:760px)').matches) $('historyPanel').classList.add('collapsed');
  function closeAllModals(){
    ['overlay','overlayReport','overlayAccess'].forEach(function(id){ $(id).classList.add('hidden'); });
  }
  ['overlay','overlayReport','overlayAccess'].forEach(function(id){
    $(id).addEventListener('click', function(e){ if(e.target === $(id)) $(id).classList.add('hidden'); });
  });
  function openSettings(){
    $('overlay').classList.remove('hidden');
    if(!$('archiveUntil').value) $('archiveUntil').value = (new Date().getFullYear()-1)+'-12-31';
    renderSettingsCourseSelect();
    renderRoster();
  }
  $('btnSettings').onclick = openSettings;
  $('btnCloseSettings').onclick = function(){ $('overlay').classList.add('hidden'); };
  function renderSettingsCourseSelect(){
    var sel = $('settingsCourseSelect');
    sel.innerHTML = '';
    if(!state.courses.length){
      var o = document.createElement('option'); o.textContent = 'Ningún curso creado todavía';
      sel.appendChild(o); return;
    }
    state.courses.forEach(function(c){
      var opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      if(c.id === state.selectedCourseId) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  function settingsSelectedCourse(){
    var id = $('settingsCourseSelect').value;
    return state.courses.find(function(c){ return c.id === id; });
  }
  function renderRoster(){
    var course = settingsSelectedCourse();
    var box = $('rosterList');
    if(!course){ box.innerHTML = '<div class="roster-empty">Crea un curso primero.</div>'; return; }
    if(!course.students.length){ box.innerHTML = '<div class="roster-empty">Sin estudiantes todavía.</div>'; return; }
    box.innerHTML = '';
    course.students.forEach(function(s){
      var row = document.createElement('div');
      row.className = 'roster-item';
      row.innerHTML = '<span>'+escapeHtml(s.name) +
        '<span class="em">Apoderado: '+(s.guardianEmail ? escapeHtml(s.guardianEmail) : 'sin correo')+'</span>' +
        '<span class="em">Estudiante: '+(s.studentEmail ? escapeHtml(s.studentEmail) : 'sin correo')+'</span></span>' +
        '<span class="acts"><button type="button" class="b-mail">Apoderado</button><button type="button" class="b-smail">Estudiante</button><button type="button" class="b-del">Quitar</button></span>';
      row.querySelector('.b-mail').onclick = function(){
        var v = prompt('Correo del apoderado de '+s.name+' (puedes poner dos separados por coma):', s.guardianEmail || '');
        if(v === null) return;
        runServer('setGuardianEmail', s.id, v).then(function(saved){
          s.guardianEmail = saved;
          renderRoster(); renderAll();
          toast(saved ? 'Correo del apoderado guardado' : 'Correo del apoderado eliminado');
        }).catch(function(err){ toast(errText(err), true); });
      };
      row.querySelector('.b-smail').onclick = function(){
        var v = prompt('Correo institucional de '+s.name+':', s.studentEmail || '');
        if(v === null) return;
        runServer('setStudentEmail', s.id, v).then(function(saved){
          s.studentEmail = saved;
          renderRoster(); renderAll();
          toast(saved ? 'Correo del estudiante guardado' : 'Correo del estudiante eliminado');
        }).catch(function(err){ toast(errText(err), true); });
      };
      row.querySelector('.b-del').onclick = function(){
        if(!confirm('¿Quitar a '+s.name+' de '+course.name+'?')) return;
        runServer('removeStudent', s.id).then(function(){
          course.students = course.students.filter(function(x){ return x.id !== s.id; });
          renderRoster(); renderAll();
        }).catch(function(err){ toast('No se pudo quitar: '+errText(err), true); });
      };
      box.appendChild(row);
    });
  }
  $('settingsCourseSelect').onchange = renderRoster;

  $('btnAddCourse').onclick = function(){
    var input = $('newCourseName');
    var name = input.value.trim();
    if(!name) return;
    if(state.courses.some(function(c){ return c.name.toLowerCase() === name.toLowerCase(); })){
      if(!confirm('Ya existe un curso llamado "'+name+'". ¿Crear otro con el mismo nombre?')) return;
    }
    var btn = $('btnAddCourse'); btn.disabled = true;
    runServer('addCourse', name).then(function(course){
      state.courses.push(course);
      state.selectedCourseId = course.id;
      input.value = '';
      renderSettingsCourseSelect(); renderRoster(); renderAll();
    }).catch(function(err){ toast('No se pudo crear el curso: '+errText(err), true); })
      .then(function(){ btn.disabled = false; });
  };

  $('btnAddStudents').onclick = function(){
    var course = settingsSelectedCourse();
    if(!course) return;
    var ta = $('newStudents');
    var lines = ta.value.split('\n').map(function(l){ return l.replace(/\s+/g,' ').trim(); }).filter(Boolean);
    if(!lines.length) return;
    var btn = $('btnAddStudents'); btn.disabled = true;
    runServer('addStudents', course.id, lines.join('\n')).then(function(res){
      (res.added || []).forEach(function(s){ course.students.push(s); });
      (res.updated || []).forEach(function(u){
        var st = course.students.find(function(x){ return x.id === u.id; });
        if(st){ st.guardianEmail = u.guardianEmail; st.studentEmail = u.studentEmail; }
      });
      ta.value = '';
      renderRoster(); renderAll();
      toast((res.added||[]).length+' agregados · '+(res.updated||[]).length+' con correos actualizados');
    }).catch(function(err){ toast('No se pudo agregar: '+errText(err), true); })
      .then(function(){ btn.disabled = false; });
  };

  $('btnDeleteCourse').onclick = function(){
    var course = settingsSelectedCourse();
    if(!course) return;
    if(!confirm('¿Eliminar "'+course.name+'" y todos sus estudiantes? Los registros históricos se mantienen en la hoja.')) return;
    runServer('deleteCourse', course.id).then(function(){
      state.courses = state.courses.filter(function(c){ return c.id !== course.id; });
      if(state.selectedCourseId === course.id) state.selectedCourseId = null;
      renderSettingsCourseSelect(); renderRoster(); renderAll();
    }).catch(function(err){ toast('No se pudo eliminar: '+errText(err), true); });
  };

  $('btnArchive').onclick = function(){
    var until = $('archiveUntil').value;
    if(!until) return;
    var n = state.records.filter(function(r){ return r.date <= until; }).length;
    if(!confirm('Se moverán a un archivo aparte todos los registros, sesiones y accesos hasta el '+fmtDateCL(until)+'.\n\nRegistros de acciones afectados: '+n+'.\n\nDejarán de verse en la plataforma, pero quedarán guardados en el archivo. ¿Continuar?')) return;
    var btn = $('btnArchive'), st = $('archiveStatus');
    btn.disabled = true;
    st.className = 'status-line'; st.textContent = 'Archivando… no cierres esta ventana.';
    runServer('archivarRegistros', until).then(function(res){
      if(!res || !res.total){ st.textContent = 'No había datos hasta esa fecha. No se creó ningún archivo.'; return; }
      st.className = 'status-line ok';
      st.innerHTML = 'Listo: '+res.registros+' registros, '+res.sesiones+' sesiones y '+res.accesos+' accesos archivados en <a target="_blank" href="'+escapeHtml(res.url)+'">'+escapeHtml(res.name)+'</a>.';
      refreshData(true);
    }).catch(function(err){
      st.className = 'status-line err'; st.textContent = 'No se pudo archivar: '+errText(err);
    }).then(function(){ btn.disabled = false; });
  };

  var lastReportRows = [];
  function openReport(){
    $('overlayReport').classList.remove('hidden');
    renderReportCourseSelect();
    renderReportStudentSelect();
    renderReportTipoSelect();
    if(!$('reportFrom').value && !$('reportTo').value){
      $('reportFrom').value = monthStart();
      $('reportTo').value = todayStr();
    }
    generateReport();
  }
  $('btnReport').onclick = openReport;
  $('btnCloseReport').onclick = function(){ $('overlayReport').classList.add('hidden'); };
  function fillSelect(sel, allLabel, items){
    var current = sel.value;
    sel.innerHTML = '';
    var o = document.createElement('option'); o.value = ''; o.textContent = allLabel; sel.appendChild(o);
    items.forEach(function(it){ var opt = document.createElement('option'); opt.value = it.value; opt.textContent = it.label; sel.appendChild(opt); });
    if(current && items.some(function(it){ return it.value === current; })) sel.value = current;
  }
  function renderReportCourseSelect(){
    fillSelect($('reportCourse'), 'Todos los cursos', state.courses.map(function(c){ return { value:c.id, label:c.name }; }));
  }
  function renderReportStudentSelect(){
    var courseId = $('reportCourse').value;
    var pool = [];
    state.courses.forEach(function(c){
      if(courseId && c.id !== courseId) return;
      c.students.forEach(function(s){ pool.push({ value:s.id, label:s.name + (courseId ? '' : ' · '+c.name) }); });
    });
    pool.sort(function(a,b){ return a.label.localeCompare(b.label); });
    fillSelect($('reportStudent'), 'Todos los estudiantes', pool);
  }
  function renderReportTipoSelect(){
    fillSelect($('reportTipo'), 'Todos los tipos', state.tipos.map(function(t){ return { value:t, label:t }; }));
  }
  function generateReport(){
    var courseId = $('reportCourse').value, studentId = $('reportStudent').value, tipo = $('reportTipo').value;
    var from = $('reportFrom').value, to = $('reportTo').value;
    var rows = state.records.filter(function(r){
      if(courseId && r.courseId !== courseId) return false;
      if(studentId && r.studentId !== studentId) return false;
      if(tipo && r.tipo !== tipo) return false;
      if(from && r.date < from) return false;
      if(to && r.date > to) return false;
      return true;
    });
    rows.sort(function(a,b){ return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    lastReportRows = rows;
    var students = {};
    rows.forEach(function(r){ students[r.studentId] = true; });
    var html = '<div class="stat"><span class="num">'+rows.length+'</span><span class="lbl">Registros en el periodo</span></div>' +
               '<div class="stat"><span class="num">'+Object.keys(students).length+'</span><span class="lbl">Estudiantes involucrados</span></div>';
    state.tipos.forEach(function(t){
      if(tipo && t !== tipo) return;
      var n = rows.filter(function(r){ return r.tipo === t; }).length;
      var st = styleOf(t);
      html += '<div class="stat" style="border-left:4px solid '+st.c+'"><span class="num">'+n+'</span><span class="lbl">'+escapeHtml(st.short)+'</span></div>';
    });
    $('reportSummary').innerHTML = html;
    var box = $('reportResults');
    if(!rows.length){ box.innerHTML = '<div class="report-empty">No hay registros con estos filtros.</div>'; return; }
    if(!studentId){
      var byStudent = {};
      rows.forEach(function(r){
        if(!byStudent[r.studentId]) byStudent[r.studentId] = { name:r.studentName, course:r.courseName, total:0, per:{}, last:'' };
        var b = byStudent[r.studentId];
        b.total++; b.per[r.tipo] = (b.per[r.tipo]||0) + 1; b.last = r.date+' '+r.time;
      });
      var list = Object.keys(byStudent).map(function(k){ return byStudent[k]; });
      list.sort(function(a,b){ return b.total - a.total || a.name.localeCompare(b.name); });
      var cols = state.tipos.filter(function(t){ return !tipo || t === tipo; });
      var t = '<table class="report-table"><thead><tr><th>Estudiante</th><th>Curso</th>';
      cols.forEach(function(c){ t += '<th>'+escapeHtml(styleOf(c).short)+'</th>'; });
      t += '<th>Total</th><th>Último</th></tr></thead><tbody>';
      list.forEach(function(s){
        t += '<tr><td>'+escapeHtml(s.name)+'</td><td>'+escapeHtml(s.course)+'</td>';
        cols.forEach(function(c){ t += '<td class="num">'+(s.per[c]||0)+'</td>'; });
        t += '<td class="num">'+s.total+'</td><td>'+s.last+'</td></tr>';
      });
      box.innerHTML = t + '</tbody></table>';
    } else {
      var t2 = '<table class="report-table"><thead><tr><th>Fecha</th><th>Hora</th><th>Tipo</th><th>Curso</th><th>Registrado por</th><th>Aviso apoderado</th><th>Aviso estudiante</th></tr></thead><tbody>';
      rows.forEach(function(r){
        t2 += '<tr><td>'+r.date+'</td><td>'+r.time+'</td><td>'+tagHtml(r.tipo)+'</td><td>'+escapeHtml(r.courseName)+'</td><td>'+escapeHtml(r.by||'')+'</td><td>'+escapeHtml(r.mailStatus||'')+'</td><td>'+escapeHtml(r.studentMailStatus||'')+'</td></tr>';
      });
      box.innerHTML = t2 + '</tbody></table>';
    }
  }
  $('reportCourse').onchange = function(){ renderReportStudentSelect(); generateReport(); };
  ['reportStudent','reportTipo','reportFrom','reportTo'].forEach(function(id){ $(id).onchange = generateReport; });
  $('reportPresetMonth').onclick = function(){ $('reportFrom').value = monthStart(); $('reportTo').value = todayStr(); generateReport(); };
  $('reportPresetAll').onclick = function(){ $('reportFrom').value = ''; $('reportTo').value = ''; generateReport(); };

  var usage = { data:null, tab:'docentes', metric:'min', exportRows:[], exportName:'uso' };
  function daysAgo(n){ var d = new Date(); d.setDate(d.getDate()-n); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
  function fmtDur(sec){
    sec = Math.round(sec||0);
    if(sec <= 0) return '0 min';
    if(sec < 60) return '< 1 min';
    var m = Math.round(sec/60);
    return m < 60 ? m+' min' : Math.floor(m/60)+' h '+pad2(m%60)+' min';
  }
  function toMin(hhmm){ var p = String(hhmm||'').split(':'); return p.length === 2 ? (+p[0])*60 + (+p[1]) : NaN; }
  function fmtDateCL(iso){ var p = String(iso||'').split('-'); return p.length === 3 ? p[2]+'-'+p[1]+'-'+p[0] : iso; }
  function saveCsv(rows, filename){
    var csv = rows.map(function(row){ return row.map(function(c){ return '"'+String(c==null?'':c).replace(/"/g,'""')+'"'; }).join(';'); }).join('\n');
    var blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('usageExport').onclick = function(){ if(usage.exportRows.length) saveCsv(usage.exportRows, usage.exportName+'-'+todayStr()+'.csv'); };
  $('btnAccess').onclick = function(){
    $('overlayAccess').classList.remove('hidden');
    if(!$('usageFrom').value && !$('usageTo').value){ $('usageFrom').value = monthStart(); $('usageTo').value = todayStr(); }
    $('usageKpis').innerHTML = '';
    $('usageBody').innerHTML = '<div class="report-empty">Cargando datos de uso…</div>';
    runServer('getUsageData').then(function(d){
      usage.data = d;
      var seen = {}, roles = [];
      (d.perfiles || []).concat((d.users || []).map(function(u){ return u.role; })).forEach(function(r){ if(r && !seen[r]){ seen[r] = 1; roles.push(r); } });
      fillSelect($('usageRole'), 'Todos los perfiles', roles.map(function(r){ return { value:r, label:r }; }));
      refillUsageUsers();
      renderUsage();
    }).catch(function(err){ $('usageBody').innerHTML = '<div class="report-empty">'+escapeHtml(errText(err))+'</div>'; });
  };
  function refillUsageUsers(){
    var role = $('usageRole').value;
    var users = ((usage.data && usage.data.users) || []).filter(function(u){ return !role || u.role === role; }).sort(function(x,y){ return x.name.localeCompare(y.name); });
    fillSelect($('usageUser'), 'Todos los usuarios', users.map(function(u){ return { value:u.email, label:u.name+' · '+u.email+(u.role && u.role !== 'Docente' ? ' ('+u.role+')' : '') }; }));
  }
  $('usageRole').onchange = function(){ refillUsageUsers(); renderUsage(); };
  $('btnCloseAccess').onclick = function(){ $('overlayAccess').classList.add('hidden'); };
  ['usageUser','usageFrom','usageTo'].forEach(function(id){ $(id).onchange = renderUsage; });
  $('usage7').onclick = function(){ $('usageFrom').value = daysAgo(6); $('usageTo').value = todayStr(); renderUsage(); };
  $('usageMonth').onclick = function(){ $('usageFrom').value = monthStart(); $('usageTo').value = todayStr(); renderUsage(); };
  $('usageAll').onclick = function(){ $('usageFrom').value = ''; $('usageTo').value = ''; renderUsage(); };
  Array.prototype.forEach.call(document.querySelectorAll('#usageTabs .tab2'), function(b){
    b.onclick = function(){
      usage.tab = b.dataset.t;
      Array.prototype.forEach.call(document.querySelectorAll('#usageTabs .tab2'), function(x){ x.classList.toggle('active', x === b); });
      renderUsage();
    };
  });
  function computeUsage(){
    var d = usage.data, from = $('usageFrom').value, to = $('usageTo').value, sel = $('usageUser').value;
    function inRange(x){ return (!from || x >= from) && (!to || x <= to); }
    var names = {}, roles = {}, roleSel = $('usageRole').value;
    (d.users||[]).forEach(function(u){ names[u.email] = u.name; roles[u.email] = u.role || 'Docente'; });
    function nameOf(e){ return names[e] || e; }
    function roleOf(e){ return roles[e] || ''; }
    function inRole(e){ return !roleSel || roles[e] === roleSel; }
    var sessions = d.sessions.filter(function(x){ return inRange(x.date) && (!sel || x.user === sel) && inRole(x.user); });
    var accesses = d.accesses.filter(function(x){ return inRange(x.date) && (!sel || x.user === sel) && inRole(x.user); });
    var records = state.records.filter(function(r){ var e = String(r.by||'').toLowerCase(); return inRange(r.date) && (!sel || e === sel) && inRole(e); });
    var per = {};
    function get(e){
      if(!per[e]) per[e] = { email:e, name:nameOf(e), role:roleOf(e), authorized: e in names, ingresos:0, sesiones:0, activeSec:0, days:{}, byTipo:{}, total:0, avisos:0, last:'' };
      return per[e];
    }
    (d.users||[]).forEach(function(u){ if((!sel || u.email === sel) && inRole(u.email)) get(u.email); });
    function bumpLast(p, stamp){ if(stamp > p.last) p.last = stamp; }
    accesses.forEach(function(a){
      if(a.event === 'Acceso denegado' && !(a.user in names)) return;
      var p = get(a.user);
      if(a.event === 'Ingresó a la plataforma'){ p.ingresos++; p.days[a.date] = 1; bumpLast(p, a.date+' '+a.time); }
    });
    sessions.forEach(function(x){
      var p = get(x.user);
      p.sesiones++; p.activeSec += x.active; p.days[x.date] = 1; bumpLast(p, x.date+' '+x.start);
    });
    records.forEach(function(r){
      var p = get(String(r.by||'').toLowerCase());
      p.byTipo[r.tipo] = (p.byTipo[r.tipo]||0) + 1; p.total++; p.days[r.date] = 1;
      if(/^Enviado/.test(r.mailStatus||'')) p.avisos++;
    });
    var docentes = Object.keys(per).map(function(k){ return per[k]; });
    docentes.forEach(function(p){ p.nDays = Object.keys(p.days).length; p.used = p.ingresos + p.sesiones + p.total > 0; });
    docentes.sort(function(a,b){ return (b.activeSec - a.activeSec) || (b.ingresos - a.ingresos) || a.name.localeCompare(b.name); });
    var authorized = docentes.filter(function(p){ return p.authorized; });
    var denied = accesses.filter(function(a){ return a.event === 'Acceso denegado'; });
    var totalActive = sessions.reduce(function(s,x){ return s + x.active; }, 0);
    return {
      from:from, to:to, nameOf:nameOf, roleOf:roleOf, sessions:sessions, accesses:accesses, records:records, docentes:docentes,
      kpis:{
        activos: docentes.filter(function(p){ return p.used; }).length,
        autorizados: authorized.length,
        sinUso: authorized.filter(function(p){ return !p.used; }).length,
        ingresos: docentes.reduce(function(s,p){ return s + p.ingresos; }, 0),
        tiempo: totalActive,
        promedio: sessions.length ? totalActive / sessions.length : 0,
        registros: records.length,
        avisos: records.filter(function(r){ return /^Enviado/.test(r.mailStatus||''); }).length,
        avisosEst: records.filter(function(r){ return /^Enviado/.test(r.studentMailStatus||''); }).length,
        denegados: denied.length
      }
    };
  }

  function weekStartOf(iso){
    var d = new Date(iso+'T12:00:00');
    d.setDate(d.getDate() - ((d.getDay()+6) % 7));
    return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  }
  function addDaysIso(iso, n){
    var d = new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n);
    return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  }
  function shortDm(iso){ var p = iso.split('-'); return p[2]+'-'+p[1]; }
  function groupMail(rows, keyFn, labelFn){
    var g = {}, order = [];
    rows.forEach(function(r){
      var k = keyFn(r.date);
      if(!g[k]){ g[k] = { key:k, label:labelFn(k), total:0, days:0, apoderado:0, estudiante:0, alertas:0, pruebas:0, errores:0 }; order.push(k); }
      var o = g[k];
      o.total += r.total; o.apoderado += r.apoderado; o.estudiante += r.estudiante; o.alertas += r.alertas; o.pruebas += r.pruebas; o.errores += r.errores;
      if(r.total > 0) o.days++;
    });
    return order.sort().reverse().map(function(k){ var o = g[k]; o.avg = o.days ? o.total / o.days : 0; return o; });
  }
  var MAIL_COLS = ['Periodo','Correos','Días con envíos','Promedio diario','Apoderados','Estudiantes','Alertas','En modo prueba','Errores'];
  function mailTable(groups){
    var t = '<div class="report-results" style="max-height:260px"><table class="report-table"><thead><tr>'+MAIL_COLS.map(function(h){ return '<th>'+h+'</th>'; }).join('')+'</tr></thead><tbody>';
    groups.forEach(function(o){
      t += '<tr><td>'+escapeHtml(o.label)+'</td><td class="num"><b>'+fmtNum(o.total)+'</b></td><td class="num">'+o.days+'</td><td class="num">'+fmtNum(o.avg,1)+'</td><td class="num">'+fmtNum(o.apoderado)+'</td><td class="num">'+fmtNum(o.estudiante)+'</td><td class="num">'+fmtNum(o.alertas)+'</td><td class="num">'+fmtNum(o.pruebas)+'</td><td class="num">'+fmtNum(o.errores)+'</td></tr>';
    });
    return t + '</tbody></table></div>';
  }
  function mailCsvRows(groups){
    return groups.map(function(o){ return [o.label, o.total, o.days, String(Math.round(o.avg*10)/10).replace('.',','), o.apoderado, o.estudiante, o.alertas, o.pruebas, o.errores]; });
  }
  function renderCorreos(){
    var m = (usage.data && usage.data.mail) || { rows:[] };
    var limit = m.limit || 1500;
    var from = $('usageFrom').value, to = $('usageTo').value;
    var all = (m.rows || []).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
    var rows = all.filter(function(r){ return (!from || r.date >= from) && (!to || r.date <= to); });
    var todayRow = all.filter(function(r){ return r.date === todayStr(); })[0];
    var total = 0, days = 0, max = null;
    rows.forEach(function(r){ total += r.total; if(r.total > 0) days++; if(!max || r.total > max.total) max = r; });
    var avg = days ? total / days : 0;
    var q = m.quotaRemaining;
    function kpi(num, lbl, warn){ return '<div class="kpi'+(warn?' warn':'')+'"><span class="num">'+num+'</span><span class="lbl">'+lbl+'</span></div>'; }
    $('usageKpis').innerHTML =
      kpi(fmtNum(todayRow ? todayRow.total : 0), 'Correos enviados hoy') +
      kpi(q != null ? fmtNum(q) : '—', 'Cuota disponible ahora (tope diario: '+fmtNum(limit)+')', q != null && q < limit * 0.2) +
      kpi(fmtNum(total), 'Correos en el periodo') +
      kpi(days, 'Días con envíos') +
      kpi(fmtNum(avg,1), 'Promedio por día con envíos') +
      kpi(max ? fmtNum(max.total) : '0', 'Día con más envíos'+(max && max.total ? ' ('+fmtDateCL(max.date)+')' : '')) +
      kpi(max ? fmtNum(max.total / limit * 100, 0)+'%' : '0%', 'Del tope diario en el día más alto', max && max.total / limit >= 0.5);
    if(!rows.length){
      $('usageBody').innerHTML = '<div class="report-empty">No hay correos contados en este periodo.</div>';
      usage.exportRows = []; return;
    }
    var daily = rows.slice(-60);
    var chart = barsSvg(daily.map(function(r){ return shortDm(r.date).replace('-','/'); }), daily.map(function(r){ return r.total; }), '#0A22B0', function(v){ return fmtNum(v); });
    var weeks = groupMail(rows, weekStartOf, function(k){ return shortDm(k)+' al '+shortDm(addDaysIso(k,6)); });
    var months = groupMail(rows, function(d){ return d.slice(0,7); }, function(k){ var p = k.split('-'); return p[1]+'/'+p[0]; });
    $('usageBody').innerHTML =
      '<div class="chart-card"><h4>Correos por día'+(rows.length > 60 ? ' (últimos 60 días del periodo)' : '')+'</h4><div class="chart-scroll">'+chart+'</div></div>' +
      '<h4 class="sub-h">Por semana (lunes a domingo)</h4>' + mailTable(weeks) +
      '<h4 class="sub-h">Por mes</h4>' + mailTable(months) +
      '<div class="usage-note">Promedio diario = correos ÷ días en que se envió al menos uno (no cuenta fines de semana ni feriados sin envíos). Los correos en modo prueba ya están incluidos en Apoderados y Estudiantes y también consumen la cuota de Google. Antes de instalar el contador, las cifras se reconstruyeron desde los registros existentes (sin alertas) y los registros archivados no se reconstruyen.</div>';
    var csv = [['Fecha','Apoderados','Estudiantes','Alertas','En modo prueba','Errores','Total']];
    rows.forEach(function(r){ csv.push([fmtDateCL(r.date), r.apoderado, r.estudiante, r.alertas, r.pruebas, r.errores, r.total]); });
    csv.push([]); csv.push(['Por semana'].concat(MAIL_COLS.slice(1))); csv = csv.concat(mailCsvRows(weeks));
    csv.push([]); csv.push(['Por mes'].concat(MAIL_COLS.slice(1))); csv = csv.concat(mailCsvRows(months));
    usage.exportRows = csv; usage.exportName = 'correos-diarios';
  }

  function renderUsage(){
    if(!usage.data) return;
    if(usage.tab === 'correos'){ renderCorreos(); return; }
    var u = computeUsage(), k = u.kpis;
    function kpi(num, lbl, warn){ return '<div class="kpi'+(warn?' warn':'')+'"><span class="num">'+num+'</span><span class="lbl">'+lbl+'</span></div>'; }
    $('usageKpis').innerHTML =
      kpi(k.activos+' / '+k.autorizados, 'Usuarios con uso / autorizados') +
      kpi(k.sinUso, 'Autorizados sin uso', k.sinUso > 0) +
      kpi(k.ingresos, 'Ingresos') +
      kpi(fmtDur(k.tiempo), 'Tiempo efectivo total') +
      kpi(fmtDur(k.promedio), 'Promedio por sesión') +
      kpi(k.registros, 'Registros realizados') +
      kpi(k.avisos, 'Avisos enviados a apoderados') +
      kpi(k.avisosEst, 'Avisos enviados a estudiantes') +
      kpi(k.denegados, 'Intentos no autorizados', k.denegados > 0);
    var fn = { docentes:renderDocentes, perfiles:renderPerfiles, actividad:renderActividad, sesiones:renderSesiones, accesos:renderAccesos }[usage.tab];
    fn(u);
  }

  function renderDocentes(u){
    var tipos = state.tipos;
    var head = ['Usuario','Correo','Perfil','Ingresos','Días con uso','Tiempo efectivo','Promedio por sesión'].concat(tipos.map(function(t){ return styleOf(t).short; })).concat(['Total registros','Avisos enviados','Último ingreso']);
    var rows = [head];
    var t = '<div class="report-results" style="max-height:380px"><table class="report-table"><thead><tr>'+head.filter(function(h){ return h !== 'Correo'; }).map(function(h){ return '<th>'+escapeHtml(h)+'</th>'; }).join('')+'</tr></thead><tbody>';
    if(!u.docentes.length) t += '<tr><td colspan="'+head.length+'" class="report-empty">Sin datos en este periodo.</td></tr>';
    u.docentes.forEach(function(p){
      var prom = p.sesiones ? p.activeSec / p.sesiones : 0;
      var last = p.last ? fmtDateCL(p.last.slice(0,10))+' '+p.last.slice(11) : (p.used ? '—' : 'Sin uso');
      t += '<tr class="'+(p.used ? '' : 'idle')+'"><td>'+escapeHtml(p.name)+(p.authorized ? '' : ' <span class="tag" style="--c:#6A7194;--cs:#ECEEF5">ya no autorizado</span>')+'<br><span class="h-by">'+escapeHtml(p.email)+'</span></td><td>'+escapeHtml(p.role || '—')+'</td>' +
        '<td class="num">'+p.ingresos+'</td><td class="num">'+p.nDays+'</td><td class="num">'+fmtDur(p.activeSec)+'</td><td class="num">'+fmtDur(prom)+'</td>' +
        tipos.map(function(tp){ return '<td class="num">'+(p.byTipo[tp]||0)+'</td>'; }).join('') +
        '<td class="num">'+p.total+'</td><td class="num">'+p.avisos+'</td><td>'+last+'</td></tr>';
      rows.push([p.name, p.email, p.role || '', p.ingresos, p.nDays, Math.round(p.activeSec/60), Math.round(prom/60)].concat(tipos.map(function(tp){ return p.byTipo[tp]||0; })).concat([p.total, p.avisos, last]));
    });
    rows[0][5] = 'Tiempo efectivo (min)'; rows[0][6] = 'Promedio por sesión (min)';
    $('usageBody').innerHTML = t + '</tbody></table></div>' +
      '<div class="usage-note">El tiempo efectivo comenzó a medirse desde que instalaste esta versión; antes de eso solo hay registro de ingresos.</div>';
    usage.exportRows = rows; usage.exportName = 'uso-por-usuario';
  }

  function barsSvg(labels, values, color, fmtVal){
    var n = labels.length;
    var bw = Math.max(12, Math.min(34, Math.floor(820 / Math.max(n,1)) - 4)), gap = 4, H = 150, top = 20, bottom = 26, left = 8;
    var W = Math.max(left*2 + n*(bw+gap), 320);
    var max = Math.max.apply(null, values.concat([1]));
    var step = Math.ceil(n / 18);
    var svg = '<svg width="'+W+'" height="'+(H+top+bottom)+'" xmlns="http://www.w3.org/2000/svg" font-family="IBM Plex Sans, Arial, sans-serif">';
    svg += '<line x1="0" x2="'+W+'" y1="'+(top+H)+'" y2="'+(top+H)+'" stroke="#D8DCEC"/>';
    values.forEach(function(v, i){
      var h = Math.round(v / max * H), x = left + i*(bw+gap), y = top + H - h;
      svg += '<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+(v > 0 ? Math.max(h,2) : 0)+'" rx="3" fill="'+color+'"><title>'+escapeHtml(labels[i]+': '+fmtVal(v))+'</title></rect>';
      if(v > 0 && n <= 35) svg += '<text x="'+(x+bw/2)+'" y="'+(y-5)+'" text-anchor="middle" font-size="10" fill="#3A4470">'+escapeHtml(String(fmtVal(v)).replace(' min',''))+'</text>';
      if(i % step === 0) svg += '<text x="'+(x+bw/2)+'" y="'+(top+H+16)+'" text-anchor="middle" font-size="10" fill="#6A7194">'+escapeHtml(labels[i])+'</text>';
    });
    return svg + '</svg>';
  }

  function renderActividad(u){
    var dates = [];
    u.sessions.forEach(function(x){ dates.push(x.date); });
    u.accesses.forEach(function(x){ dates.push(x.date); });
    u.records.forEach(function(x){ dates.push(x.date); });
    dates.sort();
    var from = u.from || dates[0] || todayStr(), to = u.to || todayStr();
    var keys = [], d = new Date(from+'T12:00:00'), end = new Date(to+'T12:00:00');
    while(d <= end && keys.length < 800){ keys.push(d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())); d.setDate(d.getDate()+1); }
    var byMonth = keys.length > 92;
    function bucket(iso){ return byMonth ? iso.slice(0,7) : iso; }
    var buckets = [], idx = {};
    keys.forEach(function(k){ var b = bucket(k); if(!(b in idx)){ idx[b] = buckets.length; buckets.push({ key:b, min:0, ing:0, reg:0 }); } });
    u.sessions.forEach(function(x){ var b = idx[bucket(x.date)]; if(b != null) buckets[b].min += x.active/60; });
    u.accesses.forEach(function(x){ if(x.event === 'Ingresó a la plataforma'){ var b = idx[bucket(x.date)]; if(b != null) buckets[b].ing++; } });
    u.records.forEach(function(x){ var b = idx[bucket(x.date)]; if(b != null) buckets[b].reg++; });
    var metric = usage.metric;
    var conf = { min:{ lbl:'Minutos de uso efectivo', color:'#0A22B0', f:function(v){ return Math.round(v)+' min'; } },
                 ing:{ lbl:'Ingresos', color:'#07157A', f:function(v){ return v; } },
                 reg:{ lbl:'Registros realizados', color:'#D5101C', f:function(v){ return v; } } }[metric];
    var labels = buckets.map(function(b){ var p = b.key.split('-'); return byMonth ? p[1]+'/'+p[0] : p[2]+'/'+p[1]; });
    var values = buckets.map(function(b){ return metric === 'min' ? Math.round(b.min) : b[metric]; });
    var hours = []; for(var h = 7; h <= 19; h++) hours.push(h);
    var hv = hours.map(function(h){ return u.records.filter(function(r){ return parseInt(r.time,10) === h; }).length; });
    var dow = ['Lun','Mar','Mié','Jue','Vie'];
    var dv = [1,2,3,4,5].map(function(n){ return u.records.filter(function(r){ return new Date(r.date+'T12:00:00').getDay() === n; }).length; });
    $('usageBody').innerHTML =
      '<div class="chart-box"><div class="chart-head"><h4>'+conf.lbl+(byMonth ? ' por mes' : ' por día')+'</h4>' +
      '<select id="usageMetric" class="field-select"><option value="min">Minutos de uso efectivo</option><option value="ing">Ingresos</option><option value="reg">Registros realizados</option></select></div>' +
      '<div class="chart-scroll">'+barsSvg(labels, values, conf.color, conf.f)+'</div></div>' +
      '<div class="modal-row">' +
        '<div class="chart-box" style="flex:1 1 380px"><div class="chart-head"><h4>Registros por hora del día</h4></div><div class="chart-scroll">'+barsSvg(hours.map(function(h){ return pad2(h)+'h'; }), hv, '#D5101C', function(v){ return v; })+'</div></div>' +
        '<div class="chart-box" style="flex:1 1 260px"><div class="chart-head"><h4>Registros por día de la semana</h4></div><div class="chart-scroll">'+barsSvg(dow, dv, '#0A22B0', function(v){ return v; })+'</div></div>' +
      '</div>';
    $('usageMetric').value = metric;
    $('usageMetric').onchange = function(e){ usage.metric = e.target.value; renderUsage(); };
    var rows = [[byMonth ? 'Mes' : 'Fecha', 'Ingresos', 'Minutos de uso efectivo', 'Registros']];
    buckets.forEach(function(b){ rows.push([byMonth ? b.key : fmtDateCL(b.key), b.ing, Math.round(b.min), b.reg]); });
    usage.exportRows = rows; usage.exportName = 'actividad-plataforma';
  }

  function renderPerfiles(u){
    var tipos = state.tipos, g = {}, order = [];
    u.docentes.forEach(function(p){
      var k = p.role || 'Sin perfil (ya no autorizado)';
      if(!g[k]){ g[k] = { perfil:k, usuarios:0, activos:0, ingresos:0, sesiones:0, activeSec:0, total:0, avisos:0, byTipo:{}, last:'' }; order.push(k); }
      var o = g[k];
      if(p.authorized) o.usuarios++;
      if(p.used) o.activos++;
      o.ingresos += p.ingresos; o.sesiones += p.sesiones; o.activeSec += p.activeSec; o.total += p.total; o.avisos += p.avisos;
      Object.keys(p.byTipo).forEach(function(t){ o.byTipo[t] = (o.byTipo[t]||0) + p.byTipo[t]; });
      if(p.last > o.last) o.last = p.last;
    });
    var list = order.map(function(k){ return g[k]; }).sort(function(a,b){ return b.activeSec - a.activeSec || b.total - a.total || a.perfil.localeCompare(b.perfil); });
    var head = ['Perfil','Usuarios autorizados','Con uso','Sin uso','Ingresos','Tiempo efectivo','Promedio por sesión'].concat(tipos.map(function(t){ return styleOf(t).short; })).concat(['Total registros','Avisos enviados','Último ingreso']);
    var rows = [head.slice()];
    rows[0][5] = 'Tiempo efectivo (min)'; rows[0][6] = 'Promedio por sesión (min)';
    var t = '<div class="report-results" style="max-height:380px"><table class="report-table"><thead><tr>'+head.map(function(h){ return '<th>'+escapeHtml(h)+'</th>'; }).join('')+'</tr></thead><tbody>';
    if(!list.length) t += '<tr><td colspan="'+head.length+'" class="report-empty">Sin datos en este periodo.</td></tr>';
    list.forEach(function(o){
      var prom = o.sesiones ? o.activeSec / o.sesiones : 0;
      var sinUso = Math.max(0, o.usuarios - o.activos);
      var last = o.last ? fmtDateCL(o.last.slice(0,10))+' '+o.last.slice(11) : 'Sin uso';
      t += '<tr><td><b>'+escapeHtml(o.perfil)+'</b></td><td class="num">'+o.usuarios+'</td><td class="num">'+o.activos+'</td><td class="num">'+sinUso+'</td><td class="num">'+o.ingresos+'</td><td class="num">'+fmtDur(o.activeSec)+'</td><td class="num">'+fmtDur(prom)+'</td>' +
        tipos.map(function(tp){ return '<td class="num">'+(o.byTipo[tp]||0)+'</td>'; }).join('') +
        '<td class="num">'+o.total+'</td><td class="num">'+o.avisos+'</td><td>'+last+'</td></tr>';
      rows.push([o.perfil, o.usuarios, o.activos, sinUso, o.ingresos, Math.round(o.activeSec/60), Math.round(prom/60)].concat(tipos.map(function(tp){ return o.byTipo[tp]||0; })).concat([o.total, o.avisos, last]));
    });
    $('usageBody').innerHTML = t + '</tbody></table></div>' +
      '<div class="usage-note">Compara el uso entre perfiles (por ejemplo, Docente y Convivencia escolar). Para ver el detalle de un perfil, elígelo en el filtro Perfil y abre la pestaña Por usuario, Sesiones o Accesos. El perfil se toma de la pestaña Usuarios tal como está hoy: si cambias el perfil de alguien, su historial pasa al perfil nuevo.</div>';
    usage.exportRows = rows; usage.exportName = 'uso-por-perfil';
  }

  function renderSesiones(u){
    var list = u.sessions.slice().sort(function(a,b){ return (b.date+b.start).localeCompare(a.date+a.start); });
    var rows = [['Fecha','Usuario','Perfil','Correo','Inicio','Última actividad','Duración (min)','Tiempo efectivo (min)','Cierre']];
    var t = '<div class="report-results" style="max-height:380px"><table class="report-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Perfil</th><th>Inicio</th><th>Última actividad</th><th>Duración</th><th>Tiempo efectivo</th><th>Cierre</th></tr></thead><tbody>';
    if(!list.length) t += '<tr><td colspan="8" class="report-empty">Sin sesiones en este periodo.</td></tr>';
    list.forEach(function(x){
      var dur = Math.max(0, toMin(x.last) - toMin(x.start)) || 0;
      var cierre = x.cierre || 'Sin cierre (se cerró la pestaña)';
      t += '<tr><td>'+fmtDateCL(x.date)+'</td><td>'+escapeHtml(u.nameOf(x.user))+'</td><td>'+escapeHtml(u.roleOf(x.user)||'—')+'</td><td>'+x.start+'</td><td>'+x.last+'</td><td class="num">'+fmtDur(dur*60)+'</td><td class="num">'+fmtDur(x.active)+'</td><td>'+escapeHtml(cierre)+'</td></tr>';
      rows.push([fmtDateCL(x.date), u.nameOf(x.user), u.roleOf(x.user), x.user, x.start, x.last, dur, Math.round(x.active/60), cierre]);
    });
    $('usageBody').innerHTML = t + '</tbody></table></div>' +
      '<div class="usage-note">Duración: desde el ingreso hasta la última señal de la app. Tiempo efectivo: solo los minutos en que la app estaba en pantalla y alguien la estaba usando.</div>';
    usage.exportRows = rows; usage.exportName = 'sesiones-plataforma';
  }

  function renderAccesos(u){
    var list = u.accesses.slice().sort(function(a,b){ return (b.date+b.time).localeCompare(a.date+a.time); });
    var rows = [['Fecha','Hora','Usuario','Perfil','Correo','Evento']];
    var t = '<div class="report-results" style="max-height:380px"><table class="report-table"><thead><tr><th>Fecha</th><th>Hora</th><th>Usuario</th><th>Perfil</th><th>Evento</th></tr></thead><tbody>';
    if(!list.length) t += '<tr><td colspan="5" class="report-empty">Sin accesos en este periodo.</td></tr>';
    list.forEach(function(a){
      var denied = a.event === 'Acceso denegado';
      t += '<tr class="'+(denied ? 'denied' : '')+'"><td>'+fmtDateCL(a.date)+'</td><td>'+a.time+'</td><td>'+escapeHtml(u.nameOf(a.user))+'<br><span class="h-by">'+escapeHtml(a.user)+'</span></td><td>'+escapeHtml(u.roleOf(a.user)||'—')+'</td><td>'+escapeHtml(a.event)+'</td></tr>';
      rows.push([fmtDateCL(a.date), a.time, u.nameOf(a.user), u.roleOf(a.user), a.user, a.event]);
    });
    $('usageBody').innerHTML = t + '</tbody></table></div>';
    usage.exportRows = rows; usage.exportName = 'accesos-plataforma';
  }

  function downloadCsv(records, filename){
    var rows = [['Fecha','Hora','Tipo','Curso','Estudiante','Registrado por','Aviso apoderado','Aviso estudiante']];
    records.forEach(function(r){ rows.push([r.date, r.time, r.tipo, r.courseName, r.studentName, r.by||'', r.mailStatus||'', r.studentMailStatus||'']); });
    saveCsv(rows, filename);
  }
  $('btnExport').onclick = function(){
    var all = state.records.slice().sort(function(a,b){ return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    downloadCsv(all, 'registros-aula-'+todayStr()+'.csv');
  };
  $('btnExportReport').onclick = function(){
    downloadCsv(lastReportRows, 'informe-'+($('reportFrom').value||'inicio')+'_a_'+($('reportTo').value||todayStr())+'.csv');
  };

  // ---------- avisos por acumulación ----------
  function inCounterWindow(r){
    var c = state.counter || {};
    if(!c.from) return true;
    if(r.date > c.from) return true;
    if(r.date < c.from) return false;
    return !c.fromTime || String(r.time) > c.fromTime;
  }
  function counterRule(tipo){ var c = state.counter || {}; return (c.rules && c.rules[tipo]) || { apo:1, est:1 }; }
  function lateOf(time){
    var blocks = (state.counter && state.counter.blocks) || [];
    var t = toMin(time);
    if(isNaN(t)) return null;
    for(var i = 0; i < blocks.length; i++){
      var b = blocks[i];
      if(t >= b.s && t <= b.e) return { block:b.label, late:t - b.s };
      if(t < b.s) return { block:b.label, late:0 };
    }
    return null;
  }
  var cntEdit = null;
  function openCounters(){
    $('overlayCounters').classList.remove('hidden');
    $('cntBody').innerHTML = '<div class="report-empty">Cargando…</div>';
    runServer('getCounterSettings').then(renderCounterSettings).catch(function(err){ $('cntBody').innerHTML = '<div class="report-empty">'+escapeHtml(errText(err))+'</div>'; });
  }
  function renderCounterSettings(cs){
    cntEdit = { period:cs.period, fechas:(cs.fechas||[]).slice(), rules:cs.rules, horario:cs.horario, window:cs.window, manual:cs.manual };
    var h = '';
    h += '<div class="cnt-now">Contando ahora <b>'+escapeHtml(cs.window.label)+'</b>.</div>';
    h += '<h3 class="cnt-h">1. Cada cuántos registros se envía el correo</h3>';
    h += '<p class="cnt-p">Cada tipo de acción tiene su propio contador por estudiante; no se suman entre sí. <b>0</b> = no enviar · <b>1</b> = en cada registro · <b>3</b> = en el 3°, 6°, 9°…</p>';
    h += '<table class="report-table cnt-table"><thead><tr><th>Acción</th><th>Al apoderado, cada</th><th>Al estudiante, cada</th></tr></thead><tbody>';
    cs.rules.forEach(function(r, i){
      h += '<tr><td>'+tagHtml(r.tipo)+' '+escapeHtml(r.tipo)+'</td>' +
        '<td><input type="number" min="0" max="99" class="cnt-n" data-i="'+i+'" data-k="apo" value="'+r.apo+'"> <span class="cnt-u">registros</span></td>' +
        '<td><input type="number" min="0" max="99" class="cnt-n" data-i="'+i+'" data-k="est" value="'+r.est+'"> <span class="cnt-u">registros</span></td></tr>';
    });
    h += '</tbody></table>';
    h += '<h3 class="cnt-h">2. Cuándo vuelven a cero los contadores</h3>';
    h += '<div class="cnt-periods">' + [['Semana','Cada semana','de lunes a domingo'],['Mes','Cada mes','el día 1 de cada mes'],['Personalizado','Períodos que yo elijo','en las fechas que indiques']].map(function(p){
      return '<label class="cnt-opt'+(cs.period === p[0] ? ' on' : '')+'"><input type="radio" name="cntPeriod" value="'+p[0]+'"'+(cs.period === p[0] ? ' checked' : '')+'><b>'+p[1]+'</b><small>'+p[2]+'</small></label>';
    }).join('') + '</div>';
    h += '<div class="cnt-dates'+(cs.period === 'Personalizado' ? '' : ' hidden')+'" id="cntDatesBox"><label>Fechas de inicio de cada período</label><div class="cnt-chips" id="cntChips"></div>' +
      '<div class="modal-row"><div class="field"><input type="date" id="cntNewDate"></div><div class="field" style="flex:0 0 auto"><button class="btn" id="cntAddDate" type="button">Agregar fecha</button></div></div>' +
      '<div class="hint">Ejemplo: 01-03 (primer semestre) y 28-07 (segundo semestre). El contador cuenta desde la fecha más reciente que ya pasó.</div></div>';
    h += '<div class="cnt-reset"><div><b>Reiniciar ahora</b><br><span>Pone todos los contadores en cero desde este momento. Los registros no se borran.'+(cs.manual ? ' Último reinicio: '+escapeHtml(fmtDateCL(cs.manual.slice(0,10))+' '+cs.manual.slice(11)) : '')+'</span></div><button class="btn danger" id="cntReset" type="button">Reiniciar contadores</button></div>';
    h += '<h3 class="cnt-h">3. Horario de bloques (para calcular los minutos de atraso)</h3>';
    h += '<textarea id="cntHorario" rows="3">'+escapeHtml(cs.horario||'')+'</textarea><div class="hint">Formato: <i>nombre: inicio-término</i>, separados por punto y coma. Ejemplo: 1°-2°: 08:00-09:35; 3°-4°: 09:55-11:20</div>';
    $('cntBody').innerHTML = h;
    renderCntChips();
    Array.prototype.forEach.call(document.querySelectorAll('input[name=cntPeriod]'), function(rb){
      rb.onchange = function(){
        cntEdit.period = rb.value;
        Array.prototype.forEach.call(document.querySelectorAll('.cnt-opt'), function(l){ l.classList.toggle('on', l.querySelector('input').checked); });
        $('cntDatesBox').classList.toggle('hidden', rb.value !== 'Personalizado');
      };
    });
    $('cntAddDate').onclick = function(){
      var v = $('cntNewDate').value;
      if(!v) return;
      if(cntEdit.fechas.indexOf(v) < 0) cntEdit.fechas.push(v);
      cntEdit.fechas.sort();
      $('cntNewDate').value = '';
      renderCntChips();
    };
    $('cntReset').onclick = function(){
      if(!confirm('¿Reiniciar todos los contadores desde este momento?\n\nLos registros no se borran; solo se empieza a contar de nuevo para los avisos.')) return;
      $('cntReset').disabled = true;
      runServer('resetCounters').then(function(res){ renderCounterSettings(res); toast('Contadores reiniciados.'); refreshData(true); })
        .catch(function(err){ toast('No se pudo reiniciar: '+errText(err), true); $('cntReset').disabled = false; });
    };
  }
  function renderCntChips(){
    var box = $('cntChips');
    if(!box) return;
    box.innerHTML = cntEdit.fechas.length ? '' : '<span class="cnt-u">Sin fechas todavía.</span>';
    cntEdit.fechas.forEach(function(f){
      var chip = document.createElement('span');
      chip.className = 'cnt-chip';
      chip.innerHTML = fmtDateCL(f)+' <button type="button" title="Quitar">×</button>';
      chip.querySelector('button').onclick = function(){ cntEdit.fechas = cntEdit.fechas.filter(function(x){ return x !== f; }); renderCntChips(); };
      box.appendChild(chip);
    });
  }
  $('btnCounters').onclick = function(){ $('overlay').classList.add('hidden'); openCounters(); };
  $('btnCntCancel').onclick = function(){ $('overlayCounters').classList.add('hidden'); };
  $('btnCntSave').onclick = function(){
    if(!cntEdit) return;
    var rules = cntEdit.rules.map(function(r){ return { tipo:r.tipo, apo:r.apo, est:r.est }; });
    Array.prototype.forEach.call(document.querySelectorAll('.cnt-n'), function(inp){
      var v = parseInt(inp.value, 10);
      rules[+inp.dataset.i][inp.dataset.k] = isNaN(v) || v < 0 ? 0 : Math.min(v, 99);
    });
    var payload = { period:cntEdit.period, fechas:cntEdit.fechas, rules:rules, horario:$('cntHorario').value };
    var btn = $('btnCntSave'); btn.disabled = true;
    runServer('saveCounterSettings', payload).then(function(res){
      renderCounterSettings(res);
      toast('Configuración de avisos guardada.');
      refreshData(true);
    }).catch(function(err){ toast('No se pudo guardar: '+errText(err), true); }).then(function(){ btn.disabled = false; });
  };

  // ---------- salidas autorizadas y datos en vivo ----------
  var EXIT_STYLE = { c:'#0E7A3E', s:'#DDF3E6', short:'Salida' };
  var EXIT_MODE = '__salida';
  function isExitMode(){ return state.currentTipo === EXIT_MODE; }
  function localMin(){ var d = new Date(); return d.getHours()*60 + d.getMinutes(); }
  function setClock(hhmm){
    var m = toMin(hhmm);
    if(isNaN(m)) return;
    var off = m - localMin();
    if(Math.abs(off) < 720) state.clockOffset = off;
  }
  function nowMin(){ return localMin() + (state.clockOffset || 0); }
  function nowHHMM(){ var m = ((nowMin() % 1440) + 1440) % 1440; return pad2(Math.floor(m/60))+':'+pad2(m%60); }
  function isExempt(s){ return (state.exitCfg.sinAlerta || []).indexOf(String(s.motivo||'').toLowerCase()) >= 0; }
  function since(hhmm){ return Math.max(0, nowMin() - toMin(hhmm)); }
  function enfCfg(){ return state.exitCfg.enf || { active:false, minLlegada:7, gracia:3, minRegreso:7 }; }
  function isEnfOnly(){ return !!(state.currentUser.isEnf && !state.currentUser.isAdmin); }
  function isEnfFlow(s){ return /^enfermer/i.test(String(s.motivo||'')) && !!enfCfg().active; }
  // Fase: 'out' (salida normal), 'transit' (camino a enfermería), 'at' (en enfermería), 'returning' (vuelve de enfermería), 'done'
  function phaseOf(s){
    if(s.estado !== 'Afuera') return 'done';
    if(!isEnfFlow(s)) return 'out';
    if(s.atendidoTime) return 'returning';
    if(s.llegoTime) return 'at';
    return 'transit';
  }
  function elapsedMin(s){
    var ph = phaseOf(s);
    if(ph === 'returning') return since(s.atendidoTime);
    if(ph === 'at') return since(s.llegoTime);
    return since(s.time);
  }
  function alarmOf(s){
    var ph = phaseOf(s);
    if(ph === 'done' || ph === 'at') return null;
    if(ph === 'returning') return s.alertaRegreso ? { text:'No ha vuelto a clases desde enfermería', time:s.alertaRegresoTime, by:/automática/i.test(s.alertaRegreso) ? 'Automática' : '' } : null;
    if(!/^Alarma/.test(s.alerta||'')) return null;
    return { text: ph === 'transit' ? 'No llegó a enfermería' : 'No ha vuelto a la sala', time:s.alertaTime, by:s.alertaBy };
  }
  function responsibleOf(s){ return phaseOf(s) === 'returning' ? (s.destino || s.by) : s.by; }
  function alarmForMe(s){ return !!state.currentUser.isConv || isMe(responsibleOf(s)); }
  function alarmKey(s){ return s.id+'|'+(s.alerta||'')+'|'+(s.alertaRegreso||''); }
  function exitLevel(s){
    if(alarmOf(s)) return 'alarm';
    var ph = phaseOf(s), e = elapsedMin(s), ec = enfCfg();
    if(ph === 'at') return 'health';
    if(ph === 'transit'){ if(e >= ec.minLlegada) return 'late'; if(e >= Math.max(1, ec.minLlegada - 2)) return 'warn'; return 'health'; }
    if(ph === 'returning'){ if(e >= ec.minRegreso) return 'late'; if(e >= Math.max(1, ec.minRegreso - 2)) return 'warn'; return 'ok'; }
    if(isExempt(s)) return 'health';
    var lim = state.exitCfg.minAlerta || 15;
    if(e >= lim) return 'late';
    if(e >= Math.max(1, lim - 5)) return 'warn';
    return 'ok';
  }
  function phaseLabel(s){
    var ph = phaseOf(s);
    if(ph === 'transit') return '🩺 Camino a enfermería';
    if(ph === 'at') return '🩺 En enfermería';
    if(ph === 'returning') return '🩺 Vuelve de enfermería';
    return isExempt(s) ? '🩺 Afuera' : '🚪 Afuera';
  }
  function canMarkBack(s){ var ph = phaseOf(s); return (ph === 'out' || ph === 'returning') && String(s.id).indexOf('tmp') !== 0; }
  function activeExit(studentId){
    for(var i = state.salidas.length - 1; i >= 0; i--){
      var s = state.salidas[i];
      if(s.studentId === studentId && s.estado === 'Afuera') return s;
    }
    return null;
  }
  function isMe(email){ return String(email||'').toLowerCase() === String(state.currentUser.email||'').toLowerCase(); }
  function canSeeExits(){ return !!(state.currentUser.isConv || state.currentUser.isAdmin); }
  function canSeeEnf(){ return !!(state.currentUser.isEnf || state.currentUser.isAdmin); }
  function minTxt(n){ return n === 1 ? '1 min' : n+' min'; }
  function exitStripHtml(s){
    var lvl = exitLevel(s), e = elapsedMin(s), ph = phaseOf(s);
    var label = lvl === 'alarm' ? '⚠ Alarma' : phaseLabel(s);
    var sub = ph === 'at' ? 'desde las '+s.llegoTime+' · ' : (ph === 'returning' ? 'despachado '+s.atendidoTime+' · ' : 'desde las '+s.time+' · ');
    var lim = ph === 'transit' ? enfCfg().minLlegada : (ph === 'returning' ? enfCfg().minRegreso : 0);
    return '<div class="exit-strip lvl-'+lvl+'"><span>'+label+' · <b>'+escapeHtml(s.motivo)+'</b><br><small>'+sub+'</small><b>'+minTxt(e)+(lim ? ' de '+lim : '')+'</b></span>' +
      (canMarkBack(s) ? '<button class="exit-back" type="button">Volvió</button>' : '') + '</div>';
  }

  // Elegir motivo
  var exitPick = null;
  function openExitPicker(course, student){
    exitPick = { course:course, student:student };
    $('exitTitle').textContent = 'Autorizar salida de '+student.name;
    $('exitSub').textContent = course.name+' · Elige el motivo. Todos los que vean el curso sabrán que está afuera.';
    var box = $('exitMotivos');
    box.innerHTML = '';
    (state.exitCfg.motivos || []).forEach(function(m){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'motivo-btn';
      var exempt = (state.exitCfg.sinAlerta || []).indexOf(m.toLowerCase()) >= 0;
      var enfm = /^enfermer/i.test(m) && enfCfg().active;
      b.innerHTML = '<span>'+escapeHtml(m)+'</span>'+(enfm ? '<small>avisa a Enfermería · '+enfCfg().minLlegada+' min para llegar</small>' : (exempt ? '<small>sin límite de tiempo</small>' : '<small>aviso a los '+(state.exitCfg.minAlerta||15)+' min</small>'));
      b.onclick = function(){ var p = exitPick; $('overlayExit').classList.add('hidden'); exitPick = null; if(p) doAuthorize(p.course, p.student, m); };
      box.appendChild(b);
    });
    $('overlayExit').classList.remove('hidden');
  }
  $('btnExitCancel').onclick = function(){ $('overlayExit').classList.add('hidden'); exitPick = null; };

  function replaceSalida(oldId, sal){
    var found = false;
    state.salidas = state.salidas.filter(function(x){ return x.id !== oldId; }).map(function(x){ if(x.id === sal.id){ found = true; return sal; } return x; });
    if(!found) state.salidas.push(sal);
  }
  function doAuthorize(course, student, motivo){
    var tmp = { id:'tmp'+Date.now(), date:todayStr(), time:nowHHMM(), courseId:course.id, courseName:course.name, studentId:student.id, studentName:student.name,
                motivo:motivo, by:String(state.currentUser.email||'').toLowerCase(), byName:state.currentUser.name||state.currentUser.email, estado:'Afuera', alerta:'', pending:true };
    state.salidas.push(tmp);
    renderAll();
    runServer('autorizarSalida', student.id, motivo).then(function(sal){
      replaceSalida(tmp.id, sal);
      renderAll();
      toast(sal.already ? student.name+' ya figuraba afuera ('+sal.motivo+' desde las '+sal.time+').' : student.name+': salida autorizada ('+motivo+').');
    }).catch(function(err){
      state.salidas = state.salidas.filter(function(x){ return x.id !== tmp.id; });
      renderAll();
      toast('No se pudo autorizar la salida: '+errText(err), true);
    });
  }
  function doReturn(s){
    if(String(s.id).indexOf('tmp') === 0){ toast('Espera un segundo, se está guardando la salida.'); return; }
    var prev = { estado:s.estado, returnTime:s.returnTime, closedBy:s.closedBy };
    s.estado = 'Volvió'; s.returnTime = nowHHMM(); s.closedBy = state.currentUser.name || state.currentUser.email;
    renderAll();
    runServer('marcarRegreso', s.id).then(function(sal){
      replaceSalida(s.id, sal);
      renderAll();
      toast(s.studentName+' volvió a la sala.');
    }).catch(function(err){
      s.estado = prev.estado; s.returnTime = prev.returnTime; s.closedBy = prev.closedBy;
      renderAll();
      toast('No se pudo marcar el regreso: '+errText(err), true);
    });
  }
  function doAlarm(s){
    var prev = s.alerta;
    s.alerta = 'Alarma'; s.alertaTime = nowHHMM(); s.alertaBy = state.currentUser.name || state.currentUser.email;
    renderAll();
    runServer('reportarNoRegreso', s.id).then(function(sal){
      replaceSalida(s.id, sal);
      renderAll();
      toast('Alarma enviada a Convivencia: '+s.studentName+' aún no vuelve.');
    }).catch(function(err){
      s.alerta = prev;
      renderAll();
      toast('No se pudo enviar la alarma: '+errText(err), true);
    });
  }

  // Pregunta a los 15 minutos (docentes) y a los 7 minutos (Enfermería: ¿llegó?)
  var overdue = { id:null, mode:'' };
  function stillPending(s, mode){
    if(!s || s.estado !== 'Afuera') return false;
    if(mode === 'enf') return phaseOf(s) === 'transit' && !s.alerta;
    if(mode === 'llega') return phaseOf(s) === 'returning';
    return phaseOf(s) === 'out' && !s.alerta;
  }
  function checkOverdueLocal(){
    if(!state.unlocked) return;
    if(overdue.id){
      var cur = state.salidas.filter(function(x){ return x.id === overdue.id; })[0];
      if(!stillPending(cur, overdue.mode)){ $('overlayOverdue').classList.add('hidden'); overdue.id = null; }
      else { renderOverdue(cur); return; }
    }
    var now = Date.now(), cands = [], mode = '';
    if(!isEnfOnly()){
      cands = state.salidas.filter(function(s){ return phaseOf(s) === 'returning' && isMe(s.destino) && !state.knownReturn[s.id] && !alarmOf(s); });
      if(cands.length){
        mode = 'llega';
        cands.forEach(function(s){ state.knownReturn[s.id] = 1; });
      }
    }
    if(!cands.length && canSeeEnf() && (state.enfScreenOpen || isEnfOnly())){
      mode = 'enf';
      cands = state.salidas.filter(function(s){
        return stillPending(s, 'enf') && String(s.id).indexOf('tmp') !== 0 && elapsedMin(s) >= enfCfg().minLlegada;
      });
    }
    if(!cands.length && !isEnfOnly()){
      mode = 'sala';
      var lim = state.exitCfg.minAlerta || 15;
      cands = state.salidas.filter(function(s){
        if(!stillPending(s, 'sala') || isExempt(s) || String(s.id).indexOf('tmp') === 0) return false;
        if(state.snooze[s.id] && state.snooze[s.id] > now) return false;
        if(elapsedMin(s) < lim) return false;
        return isMe(s.by); // solo al docente que autorizó la salida
      });
    }
    if(!cands.length) return;
    cands.sort(function(a,b){ return elapsedMin(b) - elapsedMin(a); });
    overdue.id = cands[0].id; overdue.mode = mode;
    renderOverdue(cands[0]);
    $('overlayOverdue').classList.remove('hidden');
    beep(mode === 'enf' || mode === 'llega');
  }
  function renderOverdue(s){
    if(overdue.mode === 'llega'){
      $('ovTitle').textContent = '🩺 '+s.studentName+' viene a tu sala desde enfermería';
      $('ovText').innerHTML = escapeHtml(s.courseName)+' · Enfermería lo despachó a las '+s.atendidoTime+'.<br>Confirma cuando llegue a la sala. Tiene <b>'+enfCfg().minRegreso+' min</b> para llegar.';
      $('ovNote').textContent = 'Si no confirmas su llegada a tiempo, se enviará una alarma a Convivencia y a ti.';
      $('ovBack').textContent = 'Ya llegó a la sala';
      $('ovAlarm').classList.add('hidden');
      $('ovLater').textContent = 'Aún no llega (confirmo después)';
      $('ovLater').classList.remove('hidden');
      return;
    }
    $('ovAlarm').classList.remove('hidden');
    $('ovLater').textContent = 'Revisar en 5 minutos';
    if(overdue.mode === 'enf'){
      var ec = enfCfg();
      $('ovTitle').textContent = '¿Llegó '+s.studentName+' a enfermería?';
      $('ovText').innerHTML = escapeHtml(s.courseName)+' · Lo envió '+escapeHtml(s.byName||s.by)+' a las '+s.time+'.<br>Han pasado <b>'+minTxt(elapsedMin(s))+'</b> y no se ha confirmado su llegada.';
      $('ovNote').textContent = 'Si no respondes, la alarma «no está en enfermería» se enviará sola a Convivencia a los '+(ec.minLlegada+ec.gracia)+' minutos.';
      $('ovBack').textContent = 'Sí, llegó a enfermería';
      $('ovAlarm').textContent = 'No llegó: avisar a Convivencia';
      $('ovLater').classList.add('hidden');
      return;
    }
    var auto = (state.exitCfg.minAlerta||15) + (state.exitCfg.minAuto||5);
    $('ovTitle').textContent = '¿'+s.studentName+' ya volvió a la sala?';
    $('ovText').innerHTML = escapeHtml(s.courseName)+' · Salió a <b>'+escapeHtml(s.motivo)+'</b> a las '+s.time+', autorizado/a por '+escapeHtml(s.byName||s.by)+'.<br>Han pasado <b>'+minTxt(elapsedMin(s))+'</b>. Verifica si volvió.';
    $('ovNote').textContent = 'Si nadie responde, la alarma se enviará sola a Convivencia a los '+auto+' minutos de la salida.';
    $('ovBack').textContent = 'Sí, ya volvió';
    $('ovAlarm').textContent = 'No ha vuelto: avisar a Convivencia';
    $('ovLater').classList.remove('hidden');
  }
  function closeOverdue(){ $('overlayOverdue').classList.add('hidden'); var id = overdue.id; overdue.id = null; return state.salidas.filter(function(x){ return x.id === id; })[0]; }
  $('ovBack').onclick = function(){ var mode = overdue.mode, s = closeOverdue(); if(!s) return; if(mode === 'enf') enfAction(s, 'enfLlego'); else doReturn(s); setTimeout(checkOverdueLocal, 300); };
  $('ovAlarm').onclick = function(){ var mode = overdue.mode, s = closeOverdue(); if(!s) return; if(mode === 'enf') enfAction(s, 'enfNoLlego'); else doAlarm(s); };
  $('ovLater').onclick = function(){ var mode = overdue.mode, s = closeOverdue(); if(s && mode !== 'llega') state.snooze[s.id] = Date.now() + 5*60*1000; if(mode === 'llega') checkOverdueLocal(); };

  // Sonido (los navegadores lo permiten solo después de un primer clic)
  var audioCtx = null;
  function ensureAudio(){
    try {
      if(!audioCtx){ var AC = window.AudioContext || window.webkitAudioContext; if(AC) audioCtx = new AC(); }
      if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e){}
    updateSoundBanner();
  }
  document.addEventListener('click', ensureAudio, { passive:true });
  document.addEventListener('keydown', ensureAudio, { passive:true });
  function beep(strong){
    try {
      if(!audioCtx || audioCtx.state !== 'running') return;
      var times = strong ? [0, 0.35, 0.7] : [0];
      times.forEach(function(t){
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = strong ? 880 : 660;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.28);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.3);
      });
    } catch(e){}
  }
  function updateSoundBanner(){
    var b = $('xsSound');
    var on = !!(audioCtx && audioCtx.state === 'running');
    if(b) b.classList.toggle('hidden', on);
    var b2 = $('enfSound'); if(b2) b2.classList.toggle('hidden', on);
  }

  // Botón y pantalla Salidas (Convivencia y administradores)
  function renderExitButton(){
    var btn = $('btnExits');
    btn.classList.toggle('hidden', !canSeeExits());
    if(!canSeeExits()) return;
    var out = state.salidas.filter(function(s){ return s.estado === 'Afuera'; });
    var alarms = out.filter(function(s){ return !!alarmOf(s); });
    var badge = $('exitBadge');
    badge.textContent = alarms.length ? '⚠ '+alarms.length : String(out.length);
    badge.classList.toggle('hidden', !out.length);
    badge.classList.toggle('alarm', !!alarms.length);
    btn.classList.toggle('pulse', !!alarms.length && !state.exitScreenOpen);
  }
  function renderEnfButton(){
    var b = $('btnEnf');
    b.classList.toggle('hidden', !(state.currentUser.isAdmin && enfCfg().active));
  }
  function openExitScreen(){
    state.exitScreenOpen = true;
    $('exitScreen').classList.remove('hidden');
    var sel = $('xsCourse');
    fillSelect(sel, 'Todos los cursos', state.courses.map(function(c){ return { value:c.id, label:c.name }; }));
    renderExitScreen();
    updateSoundBanner();
    renderExitButton();
    pollLive();
  }
  function closeExitScreen(){
    state.exitScreenOpen = false;
    $('exitScreen').classList.add('hidden');
    try { if(document.fullscreenElement) document.exitFullscreen(); } catch(e){}
    renderExitButton();
    resetIdle();
  }
  $('btnExits').onclick = openExitScreen;
  $('xsClose').onclick = closeExitScreen;
  $('xsCourse').onchange = renderExitScreen;
  $('xsSound').onclick = ensureAudio;
  $('xsFull').onclick = function(){
    var el = document.documentElement;
    try {
      var p = el.requestFullscreen ? el.requestFullscreen() : null;
      if(p && p.catch) p.catch(function(){ toast('Tu navegador no permitió la pantalla completa aquí. Usa la tecla F11.'); });
      else if(!p) toast('Usa la tecla F11 para pantalla completa.');
    } catch(e){ toast('Usa la tecla F11 para pantalla completa.'); }
  };
  $('xsExport').onclick = function(){
    var rows = [['Fecha','Estudiante','Curso','Motivo','Salió','Volvió','Minutos fuera','Estado','Autorizó','Cerró','Alerta','Hora alerta','Alerta por']];
    state.salidas.slice().sort(function(a,b){ return a.time.localeCompare(b.time); }).forEach(function(s){
      var mins = s.estado === 'Afuera' ? elapsedMin(s) : Math.max(0, toMin(s.returnTime) - toMin(s.time));
      rows.push([fmtDateCL(s.date), s.studentName, s.courseName, s.motivo, s.time, s.returnTime||'', mins, s.estado, s.byName||s.by, s.closedBy||'', s.alerta||'', s.alertaTime||'', s.alertaBy||'']);
    });
    saveCsv(rows, 'salidas-'+todayStr()+'.csv');
  };
  function xsCard(s){
    var lvl = exitLevel(s), e = elapsedMin(s), ph = phaseOf(s), al = alarmOf(s);
    var lim = ph === 'transit' ? enfCfg().minLlegada : (ph === 'returning' ? enfCfg().minRegreso : 0);
    var phaseTxt = ph === 'transit' ? 'Camino a enfermería' : (ph === 'at' ? 'En enfermería desde las '+s.llegoTime : (ph === 'returning' ? 'Vuelve de enfermería a la sala de '+(s.destinoName || s.destino || 'su docente')+' (despachado '+s.atendidoTime+')' : ''));
    return '<div class="xs-card lvl-'+lvl+'" data-id="'+escapeHtml(s.id)+'">' +
      '<div class="xs-min"><b>'+e+'</b><span>'+(lim ? 'de '+lim+' min' : 'min')+'</span></div>' +
      '<div class="xs-info"><div class="xs-name">'+escapeHtml(s.studentName)+'</div>' +
      '<div class="xs-meta">'+escapeHtml(s.courseName)+' · <b>'+escapeHtml(s.motivo)+'</b> · salió '+s.time+'</div>' +
      (phaseTxt ? '<div class="xs-phase">🩺 '+escapeHtml(phaseTxt)+'</div>' : '') +
      '<div class="xs-by">Autorizó: '+escapeHtml(s.byName||s.by)+'</div>' +
      (al ? '<div class="xs-alarm">⚠ '+escapeHtml(al.text)+' · alarma '+escapeHtml(al.time||'')+(al.by ? ' · '+escapeHtml(al.by) : '')+'</div>' : '') +
      (ph === 'out' && lvl === 'health' ? '<div class="xs-health">Salud: sin límite de tiempo</div>' : '') +
      '</div>' +
      (canMarkBack(s) ? '<button class="btn xs-back" type="button">Volvió</button>' : '') +
    '</div>';
  }
  function renderExitScreen(){
    if(!state.exitScreenOpen) return;
    var cid = $('xsCourse').value;
    var list = state.salidas.filter(function(s){ return !cid || s.courseId === cid; });
    var out = list.filter(function(s){ return s.estado === 'Afuera'; });
    var alarms = out.filter(function(s){ return !!alarmOf(s); }).sort(function(a,b){ return elapsedMin(b) - elapsedMin(a); });
    var rest = out.filter(function(s){ return !alarmOf(s); }).sort(function(a,b){ return elapsedMin(b) - elapsedMin(a); });
    var back = list.filter(function(s){ return s.estado !== 'Afuera'; }).sort(function(a,b){ return String(b.returnTime||'').localeCompare(String(a.returnTime||'')); });
    var lim = state.exitCfg.minAlerta || 15;
    var late = out.filter(function(s){ return exitLevel(s) === 'late'; }).length;
    $('xsClock').textContent = nowHHMM();
    $('xsSub').textContent = 'Hoy, '+fmtDateCL(todayStr())+' · se actualiza sola cada pocos segundos';
    function k(n, l, cls){ return '<div class="xs-kpi '+(cls||'')+'"><b>'+n+'</b><span>'+l+'</span></div>'; }
    $('xsKpis').innerHTML = k(out.length, 'Afuera ahora') + k(alarms.length, 'Con alarma', alarms.length ? 'alarm' : '') +
      k(late, 'Fuera de plazo', late ? 'late' : '') + k(back.length, 'Volvieron hoy') + k(list.length, 'Salidas hoy');
    $('xsAlarms').innerHTML = alarms.length ? '<h3 class="xs-h alarm">⚠ No han vuelto · alarma enviada</h3><div class="xs-grid">'+alarms.map(xsCard).join('')+'</div>' : '';
    $('xsOut').innerHTML = rest.length ? rest.map(xsCard).join('') : (alarms.length ? '' : '<div class="xs-empty">No hay estudiantes fuera de la sala en este momento.</div>');
    var t = '';
    if(back.length){
      t = '<table class="report-table"><thead><tr><th>Estudiante</th><th>Curso</th><th>Motivo</th><th>Salió</th><th>Volvió / retiro</th><th>Minutos</th><th>Autorizó</th><th>Cerró</th><th>Alerta</th></tr></thead><tbody>';
      back.forEach(function(s){
        var mins = Math.max(0, toMin(s.returnTime) - toMin(s.time));
        t += '<tr><td>'+escapeHtml(s.studentName)+'</td><td>'+escapeHtml(s.courseName)+'</td><td>'+escapeHtml(s.motivo)+'</td><td>'+s.time+'</td><td>'+escapeHtml(s.returnTime||'')+'</td><td class="num">'+(isNaN(mins) ? '' : mins)+'</td><td>'+escapeHtml(s.byName||s.by)+'</td><td>'+escapeHtml(s.closedBy||'')+'</td><td>'+escapeHtml([s.alerta ? s.alerta+' '+(s.alertaTime||'') : '', s.alertaRegreso ? s.alertaRegreso+' '+(s.alertaRegresoTime||'') : ''].filter(String).join(' · '))+'</td></tr>';
      });
      t += '</tbody></table>';
    } else t = '<div class="xs-empty">Todavía nadie ha vuelto hoy.</div>';
    $('xsBack').innerHTML = t;
    Array.prototype.forEach.call(document.querySelectorAll('#exitScreen .xs-back'), function(b){
      b.onclick = function(){
        var id = b.closest('.xs-card').getAttribute('data-id');
        var s = state.salidas.filter(function(x){ return x.id === id; })[0];
        if(s && confirm('¿Confirmas que '+s.studentName+' volvió a la sala?')) doReturn(s);
      };
    });
  }

  // ---------- Enfermería ----------
  function enfAction(s, fn, extra){
    if(String(s.id).indexOf('tmp') === 0) return;
    var snap = JSON.stringify(s);
    var t = nowHHMM(), me = state.currentUser.name || state.currentUser.email;
    if(fn === 'enfLlego'){ s.llegoTime = t; s.llegoBy = me; }
    if(fn === 'enfAtendido'){ if(!s.llegoTime){ s.llegoTime = t; s.llegoBy = me; } s.atendidoTime = t; s.atendidoBy = me; s.destino = extra || s.by; s.destinoName = docenteName(s.destino); }
    if(fn === 'enfRetirado'){ s.estado = 'Retirado'; s.returnTime = t; s.closedBy = me+' (se retira del colegio)'; }
    if(fn === 'enfNoLlego'){ s.alerta = 'Alarma: no llegó a enfermería'; s.alertaTime = t; s.alertaBy = me; state.knownAlarms[alarmKey(s)] = 1; }
    renderAll();
    var msgs = {
      enfLlego: s.studentName+': llegada confirmada.',
      enfAtendido: s.studentName+' vuelve a clases. Se avisó a '+docenteName(extra || s.by)+'; tiene '+enfCfg().minRegreso+' min para confirmar que llegó.',
      enfRetirado: s.studentName+': se retira del colegio.',
      enfNoLlego: 'Alarma enviada a Convivencia: '+s.studentName+' no está en enfermería.'
    };
    (extra ? runServer(fn, s.id, extra) : runServer(fn, s.id)).then(function(sal){
      replaceSalida(s.id, sal);
      if(alarmOf(sal)) state.knownAlarms[alarmKey(sal)] = 1;
      renderAll();
      toast(msgs[fn]);
    }).catch(function(err){
      var old = JSON.parse(snap);
      Object.keys(old).forEach(function(k){ s[k] = old[k]; });
      renderAll();
      toast('No se pudo guardar: '+errText(err), true);
    });
  }
  function docenteName(email){
    email = String(email||'').toLowerCase();
    var d = state.docentes.filter(function(x){ return x.email === email; })[0];
    if(d) return d.name;
    var s = state.salidas.filter(function(x){ return x.by === email; })[0];
    return s ? (s.byName || email) : email;
  }
  var tpick = null;
  function openTeacherPicker(s){
    tpick = s;
    $('tpTitle').textContent = '¿A qué sala vuelve '+s.studentName+'?';
    $('tpSub').textContent = s.courseName+' · Pregunta al estudiante con qué docente tiene clases ahora. Solo ese docente recibirá el aviso de que va en camino.';
    $('tpFilter').value = '';
    renderTeacherList();
    $('overlayTeacher').classList.remove('hidden');
    setTimeout(function(){ try { $('tpFilter').focus(); } catch(e){} }, 50);
  }
  function renderTeacherList(){
    var s = tpick; if(!s) return;
    var q = $('tpFilter').value.trim().toLowerCase();
    var box = $('tpList');
    box.innerHTML = '';
    var list = state.docentes.slice();
    if(s.by && !list.some(function(d){ return d.email === s.by; })) list.unshift({ email:s.by, name:s.byName || s.by, role:'' });
    list.sort(function(a,b){ return (a.email === s.by ? -1 : 0) - (b.email === s.by ? -1 : 0) || a.name.localeCompare(b.name); });
    list = list.filter(function(d){ return !q || (d.name+' '+d.email).toLowerCase().indexOf(q) >= 0; });
    if(!list.length){ box.innerHTML = '<div class="report-empty">No hay docentes con ese nombre.</div>'; return; }
    list.forEach(function(d){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tp-item';
      b.innerHTML = '<b>'+escapeHtml(d.name)+'</b><small>'+escapeHtml(d.email)+(d.email === s.by ? ' · lo envió a enfermería' : (d.role && d.role !== 'Docente' ? ' · '+escapeHtml(d.role) : ''))+'</small>';
      b.onclick = function(){ var st = tpick; $('overlayTeacher').classList.add('hidden'); tpick = null; if(st) enfAction(st, 'enfAtendido', d.email); };
      box.appendChild(b);
    });
  }
  $('tpFilter').oninput = renderTeacherList;
  $('tpCancel').onclick = function(){ $('overlayTeacher').classList.add('hidden'); tpick = null; };
  function openEnfScreen(){
    state.enfScreenOpen = true;
    $('enfScreen').classList.remove('hidden');
    $('enfBackApp').classList.toggle('hidden', isEnfOnly());
    renderEnfScreen();
    updateSoundBanner();
    pollLive();
  }
  function closeEnfScreen(){
    state.enfScreenOpen = false;
    $('enfScreen').classList.add('hidden');
    try { if(document.fullscreenElement) document.exitFullscreen(); } catch(e){}
  }
  $('btnEnf').onclick = openEnfScreen;
  $('enfBackApp').onclick = closeEnfScreen;
  $('enfLock').onclick = function(){ showEntry('Salir'); };
  $('enfSound').onclick = ensureAudio;
  $('enfFull').onclick = function(){ $('xsFull').onclick(); };
  $('enfExport').onclick = function(){
    var rows = [['Fecha','Estudiante','Curso','Envió','Salió','Llegó a enfermería','Confirmó llegada','Despachado','Despachó','Estado','Hora cierre','Cerró','Alerta','Alerta regreso']];
    state.salidas.filter(isEnfFlow).sort(function(a,b){ return a.time.localeCompare(b.time); }).forEach(function(s){
      rows.push([fmtDateCL(s.date), s.studentName, s.courseName, s.byName||s.by, s.time, s.llegoTime||'', s.llegoBy||'', s.atendidoTime||'', s.atendidoBy||'', s.estado, s.returnTime||'', s.closedBy||'', s.alerta ? s.alerta+' '+(s.alertaTime||'') : '', s.alertaRegreso ? s.alertaRegreso+' '+(s.alertaRegresoTime||'') : '']);
    });
    saveCsv(rows, 'enfermeria-'+todayStr()+'.csv');
  };
  function enfCard(s){
    var ph = phaseOf(s), lvl = exitLevel(s), e = elapsedMin(s), al = alarmOf(s), ec = enfCfg();
    var lim = ph === 'transit' ? ec.minLlegada : (ph === 'returning' ? ec.minRegreso : 0);
    var status = ph === 'transit' ? 'Enviado a las '+s.time+' · debe llegar en '+ec.minLlegada+' min' :
                 ph === 'at' ? 'En enfermería desde las '+s.llegoTime+(s.alerta ? ' · llegó después de la alarma' : '') :
                 'Despachado a las '+s.atendidoTime+' · avisado a '+(s.destinoName || docenteName(s.destino) || 'su docente');
    var btns = '';
    if(ph === 'transit') btns = '<button class="btn primary enf-b" data-fn="enfLlego" type="button">Llegó</button>' + (s.alerta ? '' : '<button class="btn alarm enf-b" data-fn="enfNoLlego" type="button">No llegó</button>');
    if(ph === 'at') btns = '<button class="btn primary enf-b" data-fn="enfAtendido" type="button">Atendido: vuelve a clases</button><button class="btn enf-b" data-fn="enfRetirado" type="button">Se retira del colegio</button>';
    return '<div class="xs-card enf-card lvl-'+lvl+'" data-id="'+escapeHtml(s.id)+'">' +
      '<div class="xs-min"><b>'+e+'</b><span>'+(lim ? 'de '+lim+' min' : 'min')+'</span></div>' +
      '<div class="xs-info"><div class="xs-name">'+escapeHtml(s.studentName)+'</div>' +
      '<div class="xs-meta">'+escapeHtml(s.courseName)+' · lo envió '+escapeHtml(s.byName||s.by)+'</div>' +
      '<div class="xs-by">'+escapeHtml(status)+'</div>' +
      (al ? '<div class="xs-alarm">⚠ '+escapeHtml(al.text)+' · alarma enviada a Convivencia '+escapeHtml(al.time||'')+'</div>' : '') +
      (btns ? '<div class="enf-btns">'+btns+'</div>' : '') +
      '</div></div>';
  }
  function renderEnfScreen(){
    if(!state.enfScreenOpen) return;
    var list = state.salidas.filter(isEnfFlow);
    var transit = list.filter(function(s){ return phaseOf(s) === 'transit'; }).sort(function(a,b){ return elapsedMin(b) - elapsedMin(a); });
    var at = list.filter(function(s){ return phaseOf(s) === 'at'; }).sort(function(a,b){ return String(a.llegoTime).localeCompare(String(b.llegoTime)); });
    var ret = list.filter(function(s){ return phaseOf(s) === 'returning'; }).sort(function(a,b){ return elapsedMin(b) - elapsedMin(a); });
    var done = list.filter(function(s){ return phaseOf(s) === 'done'; }).sort(function(a,b){ return String(b.returnTime||'').localeCompare(String(a.returnTime||'')); });
    var alarms = list.filter(function(s){ return !!alarmOf(s); }).length;
    $('enfClock').textContent = nowHHMM();
    $('enfSub').textContent = 'Hoy, '+fmtDateCL(todayStr())+' · '+(state.currentUser.name||'')+' · se actualiza sola';
    function k(n, l, cls){ return '<div class="xs-kpi '+(cls||'')+'"><b>'+n+'</b><span>'+l+'</span></div>'; }
    $('enfKpis').innerHTML = k(transit.length, 'En camino', transit.some(function(s){ return exitLevel(s) === 'late'; }) ? 'late' : '') + k(at.length, 'En enfermería') +
      k(ret.length, 'Volviendo a clases') + k(alarms, 'Alarmas', alarms ? 'alarm' : '') + k(list.length, 'Atenciones hoy');
    function grid(arr, empty){ return arr.length ? arr.map(enfCard).join('') : '<div class="xs-empty">'+empty+'</div>'; }
    $('enfTransit').innerHTML = grid(transit, 'Nadie viene en camino.');
    $('enfAt').innerHTML = grid(at, 'No hay estudiantes en enfermería.');
    $('enfReturning').innerHTML = grid(ret, 'Nadie va de vuelta a clases.');
    var t = '<div class="xs-empty">Todavía no hay atenciones cerradas hoy.</div>';
    if(done.length){
      t = '<table class="report-table"><thead><tr><th>Estudiante</th><th>Curso</th><th>Salió</th><th>Llegó</th><th>Despachado</th><th>Cierre</th><th>Resultado</th><th>Alertas</th></tr></thead><tbody>';
      done.forEach(function(s){
        t += '<tr><td>'+escapeHtml(s.studentName)+'</td><td>'+escapeHtml(s.courseName)+'</td><td>'+s.time+'</td><td>'+escapeHtml(s.llegoTime||'—')+'</td><td>'+escapeHtml(s.atendidoTime||'—')+'</td><td>'+escapeHtml(s.returnTime||'')+'</td><td>'+escapeHtml(s.estado === 'Retirado' ? 'Se retiró del colegio' : 'Volvió a la sala ('+(s.closedBy||'')+')')+'</td><td>'+escapeHtml([s.alerta, s.alertaRegreso].filter(String).join(' · '))+'</td></tr>';
      });
      t += '</tbody></table>';
    }
    $('enfDone').innerHTML = t;
    Array.prototype.forEach.call(document.querySelectorAll('#enfScreen .enf-b'), function(b){
      b.onclick = function(){
        var id = b.closest('.xs-card').getAttribute('data-id');
        var s = state.salidas.filter(function(x){ return x.id === id; })[0];
        if(!s) return;
        var fn = b.getAttribute('data-fn');
        if(fn === 'enfNoLlego' && !confirm('¿Confirmas que '+s.studentName+' NO llegó a enfermería?\n\nSe enviará una alarma a Convivencia.')) return;
        if(fn === 'enfRetirado' && !confirm('¿'+s.studentName+' se retira del colegio (por ejemplo, lo busca su apoderado)?')) return;
        if(fn === 'enfAtendido'){ openTeacherPicker(s); return; }
        enfAction(s, fn);
      };
    });
  }

  // Consulta en vivo: trae los registros y salidas de hoy solo si algo cambió
  var live = { busy:false };
  function seedKnownAlarms(){ state.salidas.forEach(function(s){ if(alarmOf(s)) state.knownAlarms[alarmKey(s)] = 1; if(phaseOf(s) === 'transit') state.knownEnf[s.id] = 1; }); }
  function applyLive(d){
    if(!d) return;
    setClock(d.serverTime);
    if(d.same){ tickExits(); return; }
    state.liveVer = d.ver;
    if(d.counter) state.counter = d.counter;
    var today = d.date;
    var serverRecs = d.records || [];
    var pendingRecs = state.records.filter(function(r){
      if(String(r.id).indexOf('tmp') !== 0) return false;
      return !serverRecs.some(function(x){ return x.studentId === r.studentId && x.tipo === r.tipo && isMe(x.by) && Math.abs(toMin(x.time) - toMin(r.time)) <= 2; });
    });
    state.records = state.records.filter(function(r){ return r.date !== today && String(r.id).indexOf('tmp') !== 0; }).concat(serverRecs).concat(pendingRecs);
    var serverSal = d.salidas || [];
    var pendingSal = state.salidas.filter(function(s){
      return String(s.id).indexOf('tmp') === 0 && !serverSal.some(function(x){ return x.studentId === s.studentId && x.estado === 'Afuera'; });
    });
    state.salidas = serverSal.concat(pendingSal);
    var fresh = state.salidas.filter(function(s){ return alarmOf(s) && !state.knownAlarms[alarmKey(s)]; });
    fresh.forEach(function(s){ state.knownAlarms[alarmKey(s)] = 1; });
    fresh = fresh.filter(alarmForMe);
    if(fresh.length){
      beep(true);
      toast('⚠ Alarma: '+fresh.map(function(s){ return s.studentName+' ('+alarmOf(s).text.toLowerCase()+')'; }).join(', ')+'. '+(state.currentUser.isConv ? 'Revisa Salidas.' : 'Convivencia ya fue avisada.'), true);
    }
    var incoming = state.salidas.filter(function(s){ return phaseOf(s) === 'transit' && !state.knownEnf[s.id]; });
    incoming.forEach(function(s){ state.knownEnf[s.id] = 1; });
    if(incoming.length && canSeeEnf() && (isEnfOnly() || state.enfScreenOpen)){
      beep(true);
      toast('🩺 Viene a enfermería: '+incoming.map(function(s){ return s.studentName+' ('+s.courseName+')'; }).join(', '));
    }
    renderAll();
    checkOverdueLocal();
  }
  function pollLive(){
    if(live.busy || !state.unlocked || document.visibilityState !== 'visible') return;
    live.busy = true;
    runServer('getLive', state.liveVer || '').then(applyLive).catch(function(){}).then(function(){ live.busy = false; });
  }
  function liveLoop(){
    pollLive();
    setTimeout(liveLoop, (state.exitScreenOpen || state.enfScreenOpen) ? 8000 : 15000);
  }
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') pollLive(); });
  // Actualiza los minutos en pantalla aunque no lleguen datos nuevos
  function tickExits(){
    var hasOut = state.salidas.some(function(s){ return s.estado === 'Afuera'; });
    if(state.exitScreenOpen) renderExitScreen();
    if(state.enfScreenOpen) renderEnfScreen();
    if(hasOut && state.unlocked && $('overlay').classList.contains('hidden')) renderGrid();
    renderExitButton();
    checkOverdueLocal();
  }
  setInterval(tickExits, 20000);

  // ---------- colores propios del colegio ----------
  // Se configuran en la tabla config (TemaColorPrimario / TemaColorPrimarioOscuro / TemaColorAcento).
  function applyTheme(t){
    if(!t) return;
    var root = document.documentElement.style, hex = /^#[0-9a-f]{3,8}$/i;
    if(hex.test(t.primary||'')){ root.setProperty('--brand', t.primary); root.setProperty('--focus', t.primary); }
    if(hex.test(t.primaryDark||'')) root.setProperty('--brand-dark', t.primaryDark);
    if(hex.test(t.accent||'')) root.setProperty('--gold', t.accent);
    try { localStorage.setItem('altoqueTema', JSON.stringify(t)); } catch(e){}
  }
  try { applyTheme(JSON.parse(localStorage.getItem('altoqueTema') || 'null')); } catch(e){}
  if(sb) rpc('get_tema').then(applyTheme).catch(function(){});

  // ---------- pantalla de carga (AlToque) ----------
  var splashStart = Date.now();
  function hideSplash(){
    var el = $('splash');
    if(!el || el.classList.contains('out')) return;
    var wait = Math.max(0, 900 - (Date.now() - splashStart));
    setTimeout(function(){
      el.classList.add('out');
      setTimeout(function(){ el.classList.add('gone'); }, 400);
    }, wait);
  }

  // ---------- inicio ----------
  function loadApp(){
    return runServer('getBootstrapData').then(function(data){
      if(data && data.denied){
        showLogin('La cuenta '+(data.email || '')+' no está autorizada para usar AlToque. Pide al administrador que la agregue, o ingresa con otra cuenta.', true);
        $('btnGoogle').textContent = 'Ingresar con otra cuenta Google';
        $('btnGoogle').onclick = signOutAndSwitch;
        hideSplash();
        return;
      }
      applyData(data);
      fillEntry();
      hideSplash();
    }).catch(function(err){
      $('entryMsg').textContent = 'No se pudieron cargar los datos: '+errText(err);
      $('entryMsg').className = 'entry-msg err';
      hideSplash();
    });
  }
  if(window.ALTOQUE_MOCK){
    loadApp();
  } else if(!sb){
    showLogin('Falta configurar la conexión: revisa el archivo config.js.', true);
    hideSplash();
  } else {
    sb.auth.getSession().then(function(r){
      if(r.data && r.data.session){ loadApp(); }
      else { showLogin(); hideSplash(); }
    }).catch(function(){ showLogin(); hideSplash(); });
  }
  // Volver a cargar si la sesión cambia en otra pestaña (por ejemplo, al cerrar sesión).
  if(sb) sb.auth.onAuthStateChange(function(ev){ if(ev === 'SIGNED_OUT' && state.unlocked) showEntry('Salir'); });

  // Antes se recargaba todo cada 30 s (lento con muchos docentes). Ahora solo se consulta lo que cambió hoy.
  setTimeout(liveLoop, 15000);
})();
