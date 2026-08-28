import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Interceptor to add JWT Authorization header if authenticated
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('yc_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    // Optional fallback for legacy test mock headers if explicit
    const mockId = localStorage.getItem('yc_mock_clerk_id');
    if (mockId) {
      config.headers['x-mock-clerk-id'] = mockId;
      config.headers['x-mock-email'] = `${mockId}@demo.your-character.app`;
      config.headers['x-mock-username'] = 'demo_user';
    }
  }
  return config;
});

export default api;

