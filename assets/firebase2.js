// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCPpQa1QXuI_aqxRQWeIQXKv-woUlOa41A",
  authDomain: "asistente-territorios.firebaseapp.com",
  projectId: "asistente-territorios",
  storageBucket: "asistente-territorios.firebasestorage.app",
  messagingSenderId: "950785797768",
  appId: "1:950785797768:web:cd2438070b14e693dc393d"
};

// Firebase imports via CDN modules
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ── Auth Helpers ──────────────────────────────────────────────────────────────
const Auth = {
  currentUser: null,
  currentRole: null,
  currentProfile: null,

  async login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async logout() {
    await signOut(auth);
    window.location.href = '/index.html';
  },

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  },

  async createCoordinator(email, password, name, maxTerr) {
    // Save current admin user reference
    const adminUser = auth.currentUser;
    
    // Create a completely separate Firebase app instance
    const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    
    try {
      // Create user in secondary app - does NOT affect main auth session
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUid = cred.user.uid;
      
      // Sign out of secondary app immediately
      await signOut(secondaryAuth);
      
      // Save coordinator profile to Firestore using main app (admin still logged in)
      await setDoc(doc(db, 'users', newUid), {
        name, email, role: 'coordinator',
        maxTerr: maxTerr || 8,
        active: true,
        createdAt: serverTimestamp()
      });
      
      return { uid: newUid };
    } finally {
      // Clean up secondary app
      await deleteApp(secondaryApp);
    }
  },

  onReady(callback) {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          this.currentUser = user;
          this.currentRole = snap.data().role;
          this.currentProfile = { uid: user.uid, ...snap.data() };
        }
      } else {
        this.currentUser = null;
        this.currentRole = null;
        this.currentProfile = null;
      }
      callback(user);
    });
  },

  requireAuth(allowedRoles) {
    return new Promise((resolve) => {
      this.onReady(async (user) => {
        if (!user) {
          window.location.href = '/index.html';
          return;
        }
        if (allowedRoles && !allowedRoles.includes(this.currentRole)) {
          if (this.currentRole === 'coordinator') window.location.href = '/coordinator/';
          else window.location.href = '/index.html';
          return;
        }
        resolve(this.currentProfile);
      });
    });
  }
};

// ── Firestore Helpers ─────────────────────────────────────────────────────────
const DB = {
  // Territories
  async getTerritories() {
    const snap = await getDocs(collection(db, 'territories'));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  },

  async getTerritory(id) {
    const snap = await getDoc(doc(db, 'territories', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async saveTerritory(data, id = null) {
    if (id) {
      await updateDoc(doc(db, 'territories', id), { ...data, updatedAt: serverTimestamp() });
      return id;
    } else {
      const ref = await addDoc(collection(db, 'territories'), { ...data, createdAt: serverTimestamp() });
      return ref.id;
    }
  },

  async deleteTerritory(id) {
    await deleteDoc(doc(db, 'territories', id));
  },

  // Addresses (subcollection)
  async getAddresses(territoryId) {
    const snap = await getDocs(collection(db, 'territories', territoryId, 'addresses'));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async saveAddress(territoryId, data, id = null) {
    if (id) {
      await updateDoc(doc(db, 'territories', territoryId, 'addresses', id), data);
    } else {
      await addDoc(collection(db, 'territories', territoryId, 'addresses'), data);
    }
  },

  async deleteAddress(territoryId, addressId) {
    await deleteDoc(doc(db, 'territories', territoryId, 'addresses', addressId));
  },

  async bulkSaveAddresses(territoryId, addresses) {
    const batch = writeBatch(db);
    // Delete existing
    const existing = await getDocs(collection(db, 'territories', territoryId, 'addresses'));
    existing.docs.forEach(d => batch.delete(d.ref));
    // Add new
    addresses.forEach((addr, i) => {
      const ref = doc(collection(db, 'territories', territoryId, 'addresses'));
      batch.set(ref, { ...addr, order: i });
    });
    await batch.commit();
  },

  // Phone records (subcollection)
  async getPhoneRecords(territoryId) {
    const snap = await getDocs(collection(db, 'territories', territoryId, 'phone'));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async savePhoneRecord(territoryId, data, id = null) {
    if (id) {
      await updateDoc(doc(db, 'territories', territoryId, 'phone', id), data);
    } else {
      await addDoc(collection(db, 'territories', territoryId, 'phone'), data);
    }
  },

  async deletePhoneRecord(territoryId, recordId) {
    await deleteDoc(doc(db, 'territories', territoryId, 'phone', recordId));
  },

  async bulkSavePhoneRecords(territoryId, records) {
    const batch = writeBatch(db);
    const existing = await getDocs(collection(db, 'territories', territoryId, 'phone'));
    existing.docs.forEach(d => batch.delete(d.ref));
    records.forEach((rec, i) => {
      const ref = doc(collection(db, 'territories', territoryId, 'phone'));
      batch.set(ref, { ...rec, order: i });
    });
    await batch.commit();
  },

  // Users / Coordinators
  async getCoordinators() {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'coordinator')));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => a.name?.localeCompare(b.name));
  },

  async updateUser(uid, data) {
    await updateDoc(doc(db, 'users', uid), data);
  },

  async deleteUser(uid) {
    await deleteDoc(doc(db, 'users', uid));
  },

  // Assignments (history)
  async getAssignments(filters = {}) {
    let constraints = [];
    if (filters.coordinatorId) constraints.push(where('coordinatorId', '==', filters.coordinatorId));
    if (filters.territoryId) constraints.push(where('territoryId', '==', filters.territoryId));
    const snap = await getDocs(query(collection(db, 'assignments'), ...constraints));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => (b.assignedDate || '').localeCompare(a.assignedDate || ''));
  },

  async createAssignment(data) {
    return await addDoc(collection(db, 'assignments'), { ...data, createdAt: serverTimestamp() });
  },

  async updateAssignment(id, data) {
    await updateDoc(doc(db, 'assignments', id), data);
  },

  // Settings
  async getSettings() {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    return snap.exists() ? snap.data() : {
      maxTerr: 8, maxDays: 120, consecutive: true,
      doorStatuses: ['Perro afuera', 'Duerme de día', 'Negocio', 'No tocar', 'Revisitar', 'Mudado'],
      phoneStatuses: ['No en casa', 'Línea desconectada', 'Persona ocupada', 'Plática', 'No interesado', 'Volvió a llamar', 'Número equivocado']
    };
  },

  async saveSettings(data) {
    await setDoc(doc(db, 'settings', 'global'), data, { merge: true });
  },

  // ── Campaigns ─────────────────────────────────────────────────────────────
  async getCampaigns() {
    const snap = await getDocs(collection(db, 'campaigns'));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  },

  async getCampaign(id) {
    const snap = await getDoc(doc(db, 'campaigns', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async saveCampaign(data, id = null) {
    if (id) {
      await updateDoc(doc(db, 'campaigns', id), { ...data, updatedAt: serverTimestamp() });
      return id;
    } else {
      const ref = await addDoc(collection(db, 'campaigns'), { ...data, createdAt: serverTimestamp() });
      return ref.id;
    }
  },

  async deleteCampaign(id) {
    // Delete all assignments for this campaign first
    const snap = await getDocs(query(collection(db, 'campaignAssignments'), where('campaignId', '==', id)));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await deleteDoc(doc(db, 'campaigns', id));
  },

  // Campaign assignments
  async getCampaignAssignments(campaignId) {
    const snap = await getDocs(query(collection(db, 'campaignAssignments'), where('campaignId', '==', campaignId)));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => String(a.territoryNumber).localeCompare(String(b.territoryNumber), undefined, { numeric: true }));
  },

  async getCampaignAssignmentsForCoordinator(campaignId, coordinatorId) {
    const snap = await getDocs(query(collection(db, 'campaignAssignments'), where('campaignId', '==', campaignId), where('coordinatorId', '==', coordinatorId)));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => String(a.territoryNumber).localeCompare(String(b.territoryNumber), undefined, { numeric: true }));
  },

  async saveCampaignAssignment(data, id = null) {
    if (id) {
      await updateDoc(doc(db, 'campaignAssignments', id), data);
    } else {
      await addDoc(collection(db, 'campaignAssignments'), { ...data, createdAt: serverTimestamp() });
    }
  },

  async bulkSaveCampaignAssignments(assignments) {
    const batch = writeBatch(db);
    assignments.forEach(a => {
      const ref = doc(collection(db, 'campaignAssignments'));
      batch.set(ref, { ...a, createdAt: new Date().toISOString() });
    });
    await batch.commit();
  },

  async deleteCampaignAssignments(campaignId) {
    const snap = await getDocs(query(collection(db, 'campaignAssignments'), where('campaignId', '==', campaignId)));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  },

  async markCampaignTerritoryComplete(assignmentId, completed) {
    await updateDoc(doc(db, 'campaignAssignments', assignmentId), {
      status: completed ? 'completado' : 'pendiente',
      completedDate: completed ? new Date().toISOString().split('T')[0] : null
    });
  },

  // Get campaign history for a coordinator (for rotation logic)
  async getCoordinatorCampaignHistory(coordinatorId) {
    const snap = await getDocs(query(collection(db, 'campaignAssignments'), where('coordinatorId', '==', coordinatorId)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Get active campaign
  async getActiveCampaign() {
    const snap = await getDocs(query(collection(db, 'campaigns'), where('status', '==', 'activa')));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  // Email report recipients
  async getReportSettings() {
    const snap = await getDoc(doc(db, 'settings', 'reports'));
    return snap.exists() ? snap.data() : { emails: [], emailjsServiceId: '', emailjsTemplateId: '', emailjsPublicKey: '' };
  },

  async saveReportSettings(data) {
    await setDoc(doc(db, 'settings', 'reports'), data, { merge: true });
  }
};

// ── Storage Helpers ───────────────────────────────────────────────────────────
const Store = {
  async uploadMapImage(territoryId, file) {
    const r = ref(storage, `maps/${territoryId}/${file.name}`);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  },

  async deleteMapImage(path) {
    const r = ref(storage, path);
    await deleteObject(r);
  }
};

// ── Utility Helpers ───────────────────────────────────────────────────────────
const Utils = {
  today() { return new Date().toISOString().split('T')[0]; },
  
  addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  },

  fmtDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${m}/${d}/${y}`;
  },

  daysUntil(dateStr) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  },

  daysAgo(dateStr) {
    if (!dateStr) return null;
    return Math.floor((new Date() - new Date(dateStr)) / 86400000);
  },

  excelDateToString(serial) {
    if (!serial || isNaN(serial)) return '';
    const utc = (serial - 25569) * 86400000;
    const d = new Date(utc);
    return d.toISOString().split('T')[0];
  },

  toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  },

  confirm(msg) {
    return window.confirm(msg);
  },

  // Parse xlsx/csv address file
  async parseAddressFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const addresses = [];
          let headerFound = false;
          for (const line of lines) {
            const cols = line.split('\t');
            if (!headerFound) {
              if (cols[0]?.toLowerCase().includes('direcci')) { headerFound = true; }
              continue;
            }
            if (line.includes('***') || line.includes('Notas')) break;
            if (cols[0]) {
              addresses.push({
                address: cols[0]?.trim() || '',
                street: cols[1]?.trim() || '',
                observation: cols[2]?.trim() || '',
                comment: cols[3]?.trim() || '',
                visitDate: cols[4] ? Utils.excelDateToString(parseFloat(cols[4])) : ''
              });
            }
          }
          resolve(addresses);
        } catch (err) { reject(err); }
      };
      reader.readAsText(file);
    });
  },

  async parsePhoneFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const records = [];
          let headerFound = false;
          for (const line of lines) {
            const cols = line.split('\t');
            if (!headerFound) {
              if (cols[0]?.toLowerCase().includes('direcci')) { headerFound = true; }
              continue;
            }
            if (line.includes('***') || line.includes('Fin')) break;
            if (cols[0]) {
              records.push({
                address: cols[0]?.trim() || '',
                name: cols[1]?.trim() || '',
                phone: cols[2]?.trim() || '',
                date: cols[3]?.trim() || '',
                callResult: cols[4]?.trim() || ''
              });
            }
          }
          resolve(records);
        } catch (err) { reject(err); }
      };
      reader.readAsText(file);
    });
  }
};

export { auth, db, storage, Auth, DB, Store, Utils };
