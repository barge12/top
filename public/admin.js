document.addEventListener('DOMContentLoaded', () => {
  let currentUser = null;

  // Elements
  const userDisplayName = document.getElementById('user-display-name');
  const userAvatarChar = document.getElementById('user-avatar-char');
  const btnLogout = document.getElementById('btn-logout');
  const globalAlertContainer = document.getElementById('global-alert-container');

  // Location Elements
  const addLocationForm = document.getElementById('add-location-form');
  const locationNameInput = document.getElementById('location-name');
  const locationList = document.getElementById('location-list');

  // Room Elements
  const roomSelectLocation = document.getElementById('room-select-location');
  const addRoomForm = document.getElementById('add-room-form');
  const roomNameInput = document.getElementById('room-name');
  const roomList = document.getElementById('room-list');

  // User Elements
  const addUserForm = document.getElementById('add-user-form');
  const newUsernameInput = document.getElementById('new-username');
  const newPasswordInput = document.getElementById('new-password');
  const newRoleSelect = document.getElementById('new-role');
  const userList = document.getElementById('user-list');

  // 1. Check Authentication & Load Profile (Must be Admin)
  async function checkAuth() {
    //   window.location.href = '/admin.html';
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();

      if (!data.loggedIn) {
        window.location.href = '/login.html';
        return;
      }

      if (data.user.role !== 'admin') {
        window.location.href = '/index.html'; // Redirect non-admins to dashboard
        return;
      }


      currentUser = data.user;
      userDisplayName.textContent = currentUser.username;
      userAvatarChar.textContent = currentUser.username.charAt(0).toUpperCase();

      // Hide load all bookings button for admin (auto-loaded)
      const loadAllBtn = document.getElementById('load-all-bookings');
      if (loadAllBtn) loadAllBtn.style.display = 'none';

      // Load initial lists
      initAdminPanel();
      loadAllBookings();
    } catch (err) {
      console.error('Yetkilendirme hatası:', err);
      window.location.href = '/login.html';
    }
  }

  // Logout Handler
  btnLogout.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/login.html';
      }
    } catch (err) {
      console.error('Çıkış hatası:', err);
    }
  });

  // Initialization
  function initAdminPanel() {
    loadLocations();
    loadUsers();
  }

  // --- LOKASYON YÖNETİMİ ---

  async function loadLocations() {
    try {
      const res = await fetch('/api/locations');
      const locations = await res.json();

      // Clear list
      locationList.innerHTML = '';

      // Clear and populate room location selectors
      const currentSelectedLoc = roomSelectLocation.value;
      roomSelectLocation.innerHTML = '<option value="">Lokasyon Seçin...</option>';

      if (locations.length === 0) {
        locationList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Lokasyon bulunmamaktadır.</div>';
        return;
      }

      locations.forEach(loc => {
        // Render in admin panel list
        const item = document.createElement('div');
        item.className = 'admin-list-item';
        item.innerHTML = `
          <span>${escapeHTML(loc.name)}</span>
          <button class="btn-icon-delete delete-location-btn" data-id="${loc.id}" title="Lokasyonu Sil">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `;
        locationList.appendChild(item);

        // Populate room select
        const option = document.createElement('option');
        option.value = loc.id;
        option.textContent = loc.name;
        roomSelectLocation.appendChild(option);
      });

      // Restore room select value if it still exists
      if (currentSelectedLoc) {
        roomSelectLocation.value = currentSelectedLoc;
      }

      // Add delete listeners
      document.querySelectorAll('.delete-location-btn').forEach(btn => {
        btn.addEventListener('click', deleteLocation);
      });

    } catch (err) {
      showGlobalAlert('Lokasyonlar yüklenirken hata oluştu.', 'danger');
    }
  }

  addLocationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearGlobalAlert();

    const name = locationNameInput.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lokasyon eklenemedi.');
      }

      locationNameInput.value = '';
      loadLocations();
      showGlobalAlert('Lokasyon başarıyla eklendi.', 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  });

  async function deleteLocation(e) {
    const id = e.currentTarget.getAttribute('data-id');
    if (!confirm('Bu lokasyonu sildiğinizde, lokasyona bağlı tüm odalar ve rezervasyonlar da silinecektir. Devam etmek istiyor musunuz?')) {
      return;
    }

    try {
      const res = await fetch(`/api/locations/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lokasyon silinemedi.');

      loadLocations();
      // Reset room panel if deleted location was selected
      if (roomSelectLocation.value === id) {
        roomSelectLocation.value = '';
        addRoomForm.style.display = 'none';
        roomList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Önce bir lokasyon seçin.</div>';
      }
      showGlobalAlert('Lokasyon ve bağlı odaları başarıyla silindi.', 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  }

  // --- ODA YÖNETİMİ ---

  roomSelectLocation.addEventListener('change', () => {
    const locId = roomSelectLocation.value;
    if (!locId) {
      addRoomForm.style.display = 'none';
      roomList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Önce bir lokasyon seçin.</div>';
      return;
    }

    addRoomForm.style.display = 'block';
    loadRooms(locId);
  });

  async function loadRooms(locationId) {
    try {
      const res = await fetch(`/api/locations/${locationId}/rooms`);
      const rooms = await res.json();

      roomList.innerHTML = '';

      if (rooms.length === 0) {
        roomList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Bu lokasyona ait oda bulunmamaktadır.</div>';
        return;
      }

      rooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'admin-list-item';
        item.innerHTML = `
          <span>${escapeHTML(room.name)}</span>
          <button class="btn-icon-delete delete-room-btn" data-id="${room.id}" title="Odayı Sil">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `;
        roomList.appendChild(item);
      });

      // Add delete listeners
      document.querySelectorAll('.delete-room-btn').forEach(btn => {
        btn.addEventListener('click', deleteRoom);
      });

    } catch (err) {
      showGlobalAlert('Odalar yüklenirken hata oluştu.', 'danger');
    }
  }

  addRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearGlobalAlert();

    const locationId = roomSelectLocation.value;
    const name = roomNameInput.value.trim();
    if (!locationId || !name) return;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, name })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Oda eklenemedi.');
      }

      roomNameInput.value = '';
      loadRooms(locationId);
      showGlobalAlert('Toplantı odası başarıyla eklendi.', 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  });

  async function deleteRoom(e) {
    const id = e.currentTarget.getAttribute('data-id');
    const locationId = roomSelectLocation.value;

    if (!confirm('Bu odayı silmek istediğinize emin misiniz? Odaya ait tüm aktif rezervasyonlar da silinecektir.')) {
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Oda silinemedi.');

      loadRooms(locationId);
      showGlobalAlert('Oda silindi.', 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  }

  // --- KULLANICI YÖNETİMİ ---

  async function loadUsers() {
    try {
      const res = await fetch('/api/users');
      const users = await res.json();

      userList.innerHTML = '';

      if (users.length === 0) {
        userList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Kullanıcı bulunamadı.</div>';
        return;
      }

      users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'admin-list-item';

        const isSelf = user.id === currentUser.id;
        const deleteButton = isSelf
          ? `<span style="font-size:0.8rem; color: var(--text-muted); font-style: italic;">Aktif Hesap</span>`
          : `<button class="btn-icon-delete delete-user-btn" data-id="${user.id}" title="Kullanıcıyı Sil">
              <i class="fa-solid fa-trash-can"></i>
             </button>`;

        const roleBadge = user.role === 'admin'
          ? '<span class="badge badge-admin">Yönetici</span>'
          : '<span class="badge badge-user">Kullanıcı</span>';

        item.innerHTML = `
          <div>
            <span style="margin-right: 0.75rem;">${escapeHTML(user.username)}</span>
            ${roleBadge}
          </div>
          <div>
            ${deleteButton}
          </div>
        `;
        userList.appendChild(item);
      });

      // Add delete listeners
      document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', deleteUser);
      });

    } catch (err) {
      showGlobalAlert('Kullanıcı listesi yüklenemedi.', 'danger');
    }
  }

  // --- BOOKINGS MANAGEMENT ---
  async function loadAllBookings() {
    try {
      const res = await fetch('/api/bookings');
      const bookings = await res.json();

      const list = document.getElementById('booking-list');
      list.innerHTML = '';
      if (bookings.length === 0) {
        list.innerHTML = '<div class="no-bookings">Rezervasyon bulunamadı.</div>';
        return;
      }

      bookings.forEach(b => {
        const item = document.createElement('div');
        item.className = 'admin-list-item';
        const roomInfo = `Oda: ${b.room_name || 'Bilinmiyor'}`;
        const locationInfo = `Lokasyon: ${b.location_name || 'Bilinmiyor'}`;
        const userInfo = b.booked_by ? `Kullanıcı: ${b.booked_by}` : 'Kullanıcı: Misafir';
        const date = b.start_time.split(' ')[0];
        item.innerHTML = `
          <span>${escapeHTML(b.title)} (${date} ${b.start_time.split(' ')[1]} - ${b.end_time.split(' ')[1]})</span>
          <div>${escapeHTML(roomInfo)} | ${escapeHTML(locationInfo)} | ${escapeHTML(userInfo)}</div>
          <button class="btn-icon-delete delete-booking-btn" data-id="${b.id}" title="Rezervasyonu Sil">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `;
        list.appendChild(item);
      });

      document.querySelectorAll('.delete-booking-btn').forEach(btn => {
        btn.addEventListener('click', deleteBooking);
      });
    } catch (err) {
      showGlobalAlert('Rezervasyonlar yüklenirken hata oluştu.', 'danger');
    }
  }

  async function deleteBooking(e) {
    const id = e.currentTarget.getAttribute('data-id');
    if (!confirm('Bu rezervasyonu silmek istediğinizden emin misiniz?')) return;
    try {
      const res = await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Silme hatası');
      loadAllBookings();
      showGlobalAlert('Rezervasyon silindi.', 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  }

  // Bind load all bookings button
  document.getElementById('load-all-bookings').addEventListener('click', loadAllBookings);


  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearGlobalAlert();

    const username = newUsernameInput.value.trim();
    const password = newPasswordInput.value;
    const role = newRoleSelect.value;

    if (!username || !password || !role) return;

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kullanıcı eklenemedi.');
      }

      newUsernameInput.value = '';
      newPasswordInput.value = '';
      loadUsers();
      showGlobalAlert(`"${username}" kullanıcısı başarıyla oluşturuldu.`, 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  });

  async function deleteUser(e) {
    const id = e.currentTarget.getAttribute('data-id');

    if (!confirm('Kullanıcıyı silmek istediğinize emin misiniz?')) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kullanıcı silinemedi.');

      loadUsers();
      showGlobalAlert('Kullanıcı başarıyla silindi.', 'success');
    } catch (err) {
      showGlobalAlert(err.message, 'danger');
    }
  }

  // --- ALERTS AND HELPERS ---

  function showGlobalAlert(message, type) {
    globalAlertContainer.innerHTML = `
      <div class="alert-box alert-${type}">
        <i class="fa-solid ${type === 'danger' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>
        <span>${message}</span>
      </div>
    `;
    // Scroll to alert
    globalAlertContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearGlobalAlert() {
    globalAlertContainer.innerHTML = '';
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  // Check auth and boot
  checkAuth();
});
