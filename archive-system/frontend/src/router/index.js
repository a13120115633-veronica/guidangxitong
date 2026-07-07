import { createRouter, createWebHashHistory } from 'vue-router';
import Home from '../views/employee/Home.vue';
import ProjectDetail from '../views/employee/ProjectDetail.vue';
import RecentUploads from '../views/employee/RecentUploads.vue';
import Download from '../views/employee/Download.vue';

const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/download', name: 'download', component: Download },
  { path: '/project/:id', name: 'project-detail', component: ProjectDetail, props: true },
  { path: '/recent', name: 'recent', component: RecentUploads }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
