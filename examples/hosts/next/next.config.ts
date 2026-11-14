import type {NextConfig} from 'next';
const config: NextConfig = {devIndicators:false,serverExternalPackages:['@huddle/host','pg','mysql2','mongodb'],experimental:{cpus:2}};
export default config;
