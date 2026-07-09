document.addEventListener('DOMContentLoaded', () => {
  let currentUser = null;
  let notificationTimeouts = [];
  let calendar = null;
  let isViewingAllUserBookings = false;

  // Notification logic
  function scheduleNotifications(bookings) {
    notificationTimeouts.forEach(clearTimeout);
    notificationTimeouts = [];

    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    const playDingAndNotify = (b) => {
      if (sessionStorage.getItem('notified_' + b.id)) return;
      sessionStorage.setItem('notified_' + b.id, 'true');

      const msg = `${b.title} toplantısı 5 dakika içinde başlayacak!`;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Toplantı Hatırlatması', { body: msg });
      }

      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 

        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
      } catch (e) {
        console.error('Ses çalınamadı:', e);
      }
    };

    const now = new Date();
    bookings.forEach(b => {
      const startTime = new Date(b.start_time.replace(' ', 'T'));
      const timeToMeeting = startTime - now;
      const fiveMins = 5 * 60 * 1000;

      if (timeToMeeting > fiveMins) {
        const timeout = setTimeout(() => {
          playDingAndNotify(b);
        }, timeToMeeting - fiveMins);
        notificationTimeouts.push(timeout);
      } else if (timeToMeeting > 0 && timeToMeeting <= fiveMins) {
        playDingAndNotify(b);
      }
    });
  }

  // DOM Elements
  const userDisplayName = document.getElementById('user-display-name');
  const userAvatarChar = document.getElementById('user-avatar-char');
  const adminNav = document.getElementById('admin-nav');
  const btnLogout = document.getElementById('btn-logout');

  const filterLocation = document.getElementById('filter-location');
  const filterRoom = document.getElementById('filter-room');
  
  const btnOpenBookingModal = document.getElementById('btn-open-booking-modal');
  const btnLoadUserBookings = document.getElementById('btn-load-user-bookings');
  
  const bookingModal = document.getElementById('booking-modal');
  const btnCloseBookingModal = document.getElementById('btn-close-booking-modal');
  const btnCancelBooking = document.getElementById('btn-cancel-booking');
  const bookingForm = document.getElementById('booking-form');
  
  const modalLocation = document.getElementById('modal-location');
  const modalRoomId = document.getElementById('modal-room-id');
  const bookingDate = document.getElementById('booking-date');
  const bookingStart = document.getElementById('booking-start');
  const bookingEnd = document.getElementById('booking-end');
  const modalAlertContainer = document.getElementById('modal-alert-container');

  // 1. Auth
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();

      if (!data.loggedIn) {
        window.location.href = '/login.html';
        return;
      }

      currentUser = data.user;
      userDisplayName.textContent = currentUser.username;
      userAvatarChar.textContent = currentUser.username.charAt(0).toUpperCase();

      if (currentUser.role === 'admin') {
        window.location.href = '/admin.html';
        return;
      }

      await loadLocations();
      initCalendar();
    } catch (err) {
      console.error('Yetkilendirme hatası:', err);
      window.location.href = '/login.html';
    }
  }

  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (err) {}
  });

  // 2. Load Locations
  async function loadLocations() {
    try {
      const res = await fetch('/api/locations');
      const locations = await res.json();

      const locOptsHtml = '<option value="">Tüm Lokasyonlar</option>' + 
        locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
      
      const modalLocOptsHtml = '<option value="">Lokasyon Seçin...</option>' + 
        locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');

      filterLocation.innerHTML = locOptsHtml;
      modalLocation.innerHTML = modalLocOptsHtml;
    } catch (err) {
      console.error('Lokasyonlar yüklenemedi:', err);
    }
  }

  // 3. Filters logic
  async function loadRoomsForSelect(locId, selectEl, isFilter) {
    selectEl.innerHTML = isFilter ? '<option value="">Tüm Odalar</option>' : '<option value="">Oda Seçin...</option>';
    if (!locId) {
      selectEl.disabled = true;
      return;
    }
    try {
      const res = await fetch(`/api/locations/${locId}/rooms`);
      const rooms = await res.json();
      rooms.forEach(room => {
        selectEl.appendChild(new Option(room.name, room.id));
      });
      selectEl.disabled = false;
    } catch (err) {}
  }

  filterLocation.addEventListener('change', async () => {
    await loadRoomsForSelect(filterLocation.value, filterRoom, true);
    isViewingAllUserBookings = false;
    if(calendar) calendar.refetchEvents();
  });

  filterRoom.addEventListener('change', () => {
    isViewingAllUserBookings = false;
    if(calendar) calendar.refetchEvents();
  });

  modalLocation.addEventListener('change', async () => {
    await loadRoomsForSelect(modalLocation.value, modalRoomId, false);
  });

  if (btnLoadUserBookings) {
    btnLoadUserBookings.addEventListener('click', () => {
      isViewingAllUserBookings = true;
      // reset filters visually
      filterLocation.value = '';
      filterRoom.innerHTML = '<option value="">Önce Lokasyon Seçin</option>';
      filterRoom.disabled = true;
      if(calendar) calendar.refetchEvents();
    });
  }

  btnOpenBookingModal.addEventListener('click', () => {
    openBookingModal(new Date(), new Date(Date.now() + 3600000));
  });

  function formatTime(d) {
    return d.toTimeString().substring(0,5);
  }
  function formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function openBookingModal(start, end, locId = '', roomId = '') {
    modalAlertContainer.innerHTML = '';
    
    bookingDate.value = formatDate(start);
    bookingStart.value = formatTime(start);
    bookingEnd.value = formatTime(end);

    modalLocation.value = locId || filterLocation.value || '';
    if (modalLocation.value) {
      await loadRoomsForSelect(modalLocation.value, modalRoomId, false);
      modalRoomId.value = roomId || filterRoom.value || '';
    } else {
      modalRoomId.innerHTML = '<option value="">Önce Lokasyon Seçin...</option>';
      modalRoomId.disabled = true;
    }

    bookingModal.classList.add('open');
  }

  const closeModal = () => {
    bookingModal.classList.remove('open');
    bookingForm.reset();
  };

  btnCloseBookingModal.addEventListener('click', closeModal);
  btnCancelBooking.addEventListener('click', closeModal);

  // 4. Calendar
  function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
      locale: 'tr',
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      buttonText: {
        today: 'Bugün',
        month: 'Ay',
        week: 'Hafta',
        day: 'Gün'
      },
      allDayText: 'Tüm Gün',
      selectable: true,
      selectMirror: true,
      height: '100%',
      events: async function(fetchInfo, successCallback, failureCallback) {
        try {
          const roomId = filterRoom.value;
          const locId = filterLocation.value;
          let url = '/api/bookings';
          const params = new URLSearchParams();
          if (roomId) params.append('roomId', roomId);
          else if (locId) params.append('locationId', locId);

          if(params.toString()) url += '?' + params.toString();

          const res = await fetch(url);
          const data = await res.json();
          
          let bookings = data;
          if (isViewingAllUserBookings) {
             bookings = bookings.filter(b => b.user_id === currentUser.id);
          }
          
          scheduleNotifications(bookings);

          const events = bookings.map(b => {
             let color = '#4caf50';
             if(b.type === 'Protokol') color = '#f44336';
             if(b.type === 'Dış Katılımcı') color = '#ff9800';
             return {
                id: b.id,
                title: `${b.room_name} - ${b.title}`,
                start: b.start_time.replace(' ', 'T'),
                end: b.end_time.replace(' ', 'T'),
                backgroundColor: color,
                extendedProps: b
             };
          });
          successCallback(events);
        } catch(e) {
          failureCallback(e);
        }
      },
      select: function(arg) {
        if (currentUser.role === 'admin') {
          calendar.unselect();
          return;
        }
        openBookingModal(arg.start, arg.end, filterLocation.value, filterRoom.value);
        calendar.unselect();
      },
      eventClick: function(arg) {
        showEventDetails(arg.event);
      }
    });
    calendar.render();
  }

  function showEventDetails(eventObj) {
    const b = eventObj.extendedProps;
    const isOwner = b.user_id === currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    
    let msg = `Toplantı: ${b.title}\nOda: ${b.room_name}\nLokasyon: ${b.location_name}\nSahibi: ${b.booked_by || 'Silinmiş Kullanıcı'}\nSaat: ${b.start_time} - ${b.end_time}`;
    if (b.description) msg += `\nNot: ${b.description}`;
    
    if (isOwner || isAdmin) {
      if (confirm(msg + '\n\nBu rezervasyonu iptal etmek ister misiniz?')) {
         deleteBookingById(b.id);
      }
    } else {
      alert(msg);
    }
  }

  async function deleteBookingById(id) {
    try {
      const res = await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rezervasyon silinemedi.');
      if(calendar) calendar.refetchEvents();
    } catch (err) {
      alert('İptal hatası: ' + err.message);
    }
  }

  // 5. Submit Booking
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    modalAlertContainer.innerHTML = '';

    const roomId = modalRoomId.value;
    if (!roomId) {
      showModalError('Lütfen bir oda seçin.');
      return;
    }

    const title = document.getElementById('booking-title').value;
    const type = document.getElementById('booking-type').value;
    const dateVal = bookingDate.value;
    const startHour = bookingStart.value;
    const endHour = bookingEnd.value;
    const description = document.getElementById('booking-desc').value;

    const startTime = `${dateVal} ${startHour}`;
    const endTime = `${dateVal} ${endHour}`;

    if (startHour >= endHour) {
      showModalError('Hata: Bitiş saati başlangıç saatinden sonra olmalıdır.');
      return;
    }

    try {
      // Overlap Check
      const checkAvailability = async () => {
        try {
          const res = await fetch(`/api/bookings?roomId=${roomId}&date=${dateVal}`);
          const existing = await res.json();
          const overlap = existing.some(b => b.start_time < endTime && b.end_time > startTime);
          return !overlap;
        } catch (err) {
          return false;
        }
      };

      const available = await checkAvailability();
      if (!available) {
        showModalError('Seçilen oda bu zaman diliminde zaten rezerve edilmiş.');
        return;
      }

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, title, startTime, endTime, type, description })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rezervasyon oluşturulamadı.');

      closeModal();
      if(calendar) calendar.refetchEvents();
    } catch (err) {
      showModalError(err.message);
    }
  });

  function showModalError(msg) {
    modalAlertContainer.innerHTML = `
      <div class="alert-box alert-danger">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>${msg}</span>
      </div>
    `;
  }

  checkAuth();
});
