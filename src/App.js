import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8080';
  const [concurrency, setConcurrency] = useState(50);
  const [duration, setDuration] = useState(180);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  // NEW: Kubernetes state
  const [k8sData, setK8sData] = useState({
    pods: [],
    hpa: null,
    metrics: []
  });
  const [k8sHistory, setK8sHistory] = useState([]);

  const intervalRef = useRef(null);
  const k8sIntervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const requestsRef = useRef([]);

  // NEW: Fetch Kubernetes data
  const fetchK8sData = async () => {
    try {
      const [podsRes, hpaRes, metricsRes] = await Promise.all([
        axios.get(`${apiUrl}/k8s/pods`),
        axios.get(`${apiUrl}/k8s/hpa`),
        axios.get(`${apiUrl}/k8s/metrics`).catch(() => ({ data: { metrics: [] } }))
      ]);

      const newK8sData = {
        pods: podsRes.data.pods || [],
        hpa: hpaRes.data.hpa || null,
        metrics: metricsRes.data.metrics || []
      };

      setK8sData(newK8sData);

      // Add to history for chart
      if (newK8sData.hpa) {
        setK8sHistory(prev => {
          const now = Date.now();
          const newHistory = [...prev, {
            timestamp: now,
            replicas: newK8sData.hpa.currentReplicas,
            cpu: newK8sData.hpa.cpuPercentage
          }];
          // Keep last 60 data points
          return newHistory.slice(-60);
        });
      }
    } catch (error) {
      console.error('Error fetching K8s data:', error);
    }
  };

  // NEW: Start K8s monitoring
  useEffect(() => {
    fetchK8sData(); // Initial fetch
    k8sIntervalRef.current = setInterval(fetchK8sData, 2000); // Update every 2 seconds

    return () => {
      if (k8sIntervalRef.current) {
        clearInterval(k8sIntervalRef.current);
      }
    };
  }, [apiUrl]);

  const testConnection = async () => {
    try {
      const response = await axios.get(`${apiUrl}/health`);
      if (response.status !== 200) {
        console.error('Health check failed:', response);
        return;
      }
      // Also test K8s endpoints
      await fetchK8sData();
    } catch (error) {
      console.error('Connection test failed:', error);
    }
  };

  const makeRequest = async () => {
    const start = Date.now();
    try {
      await axios.get(`${apiUrl}/heavy`, { timeout: 30000 });
      const responseTime = Date.now() - start;
      requestsRef.current.push({ success: true, responseTime });
    } catch (error) {
      requestsRef.current.push({ success: false, responseTime: 0 });
    }
  };

  const startLoadTest = () => {
    if (isRunning) return;

    setIsRunning(true);
    setK8sHistory([]);
    setElapsedTime(0);
    requestsRef.current = [];
    startTimeRef.current = Date.now();

    const requests = [];
    for (let i = 0; i < concurrency; i++) {
      requests.push(continuousRequests());
    }

    intervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);

      if (elapsed >= duration) {
        stopLoadTest();
      }
    }, 1000);
  };

  const continuousRequests = async () => {
    while (isRunning) {
      await makeRequest();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  const stopLoadTest = () => {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const progress = duration > 0 ? (elapsedTime / duration) * 100 : 0;

  return (
    <div className="App">
      <div className="container">
        <h1>Kubernetes Autoscaling Dashboard</h1>

        {/* Configuration Card */}
        <div className="card">
          <div className="config-grid">

            <div className="input-group">
              <label>Concurrent Requests:</label>
              <input
                type="number"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                min="1"
                max="500"
                disabled={isRunning}
              />
            </div>

            <div className="input-group">
              <label>Duration (seconds):</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min="10"
                max="600"
                disabled={isRunning}
              />
            </div>
          </div>
          <div className="controls">
            <button className="btn-test" onClick={testConnection} disabled={isRunning}>
              🔍 Test Connection
            </button>
            <button className="btn-start" onClick={startLoadTest} disabled={isRunning}>
              ▶️ Start Load Test
            </button>
            <button className="btn-stop" onClick={stopLoadTest} disabled={!isRunning}>
              ⏹️ Stop Load Test
            </button>
          </div>

          {isRunning && (
            <>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="timer">
                ⏱️ Elapsed: {elapsedTime}s / {duration}s
              </p>
            </>
          )}
        </div>

        {/* NEW: Kubernetes Status Card */}
        <div className="card k8s-card">
          <h2>
            ☸️ Kubernetes Status
            <span className="k8s-update">
              Updated {new Date().toLocaleTimeString()}
            </span>
          </h2>

          {k8sData.hpa && (
            <div className="hpa-status">
              <div className="hpa-info">
                <div className="hpa-replicas">
                  <span className="label">Replicas:</span>
                  <span className="value">
                    {k8sData.hpa.currentReplicas} / {k8sData.hpa.maxReplicas}
                  </span>
                </div>
                <div className="hpa-cpu">
                  <span className="label">CPU:</span>
                  <span className={`value ${k8sData.hpa.cpuPercentage > k8sData.hpa.targetCpuPercentage ? 'high' : ''}`}>
                    {k8sData.hpa.cpuPercentage}% / {k8sData.hpa.targetCpuPercentage}%
                  </span>
                </div>
                {k8sData.hpa.currentReplicas !== k8sData.hpa.desiredReplicas && (
                  <div className="hpa-scaling">
                    <span className="scaling-indicator">⚡ Scaling to {k8sData.hpa.desiredReplicas} replicas...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pods-grid">
            {k8sData.pods.map((pod, index) => (
              <div key={pod.name} className={`pod-card ${pod.ready ? 'ready' : 'pending'}`}>
                <div className="pod-header">
                  <span className="pod-icon">{pod.ready ? '🟢' : '🟡'}</span>
                  <span className="pod-name">Pod {index + 1}</span>
                </div>
                <div className="pod-details">
                  <div className="pod-detail">
                    <span className="detail-label">Status:</span>
                    <span className="detail-value">{pod.status}</span>
                  </div>
                  <div className="pod-detail">
                    <span className="detail-label">IP:</span>
                    <span className="detail-value">{pod.ip}</span>
                  </div>
                  {k8sData.metrics.find(m => m.name === pod.name) && (
                    <>
                      <div className="pod-detail">
                        <span className="detail-label">CPU:</span>
                        <span className="detail-value">
                          {k8sData.metrics.find(m => m.name === pod.name).cpu}
                        </span>
                      </div>
                      <div className="pod-detail">
                        <span className="detail-label">Memory:</span>
                        <span className="detail-value">
                          {k8sData.metrics.find(m => m.name === pod.name).memory}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Scaling History Chart */}
          {k8sHistory.length > 0 && (
            <div className="scaling-chart">
              <h3>📊 Scaling History</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={k8sHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
                    interval="preserveStartEnd"
                  />
                  <YAxis yAxisId="left" domain={[0, 'dataMax + 1']} label={{ value: 'Replicas', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: 'CPU %', angle: 90, position: 'insideRight' }} />
                  <Tooltip labelFormatter={(ts) => new Date(ts).toLocaleTimeString()} />
                  <Legend />
                  <Line yAxisId="left" type="stepAfter" dataKey="replicas" stroke="#667eea" strokeWidth={3} name="Pod Count" />
                  <Line yAxisId="right" type="monotone" dataKey="cpu" stroke="#f5576c" strokeWidth={2} name="CPU %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Controls Card */}


      </div>
    </div>
  );
}

export default App;