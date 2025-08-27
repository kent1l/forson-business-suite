import React from 'react';

const Icon: React.FC<any> = ({ className = "h-6 w-6", ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props} />
);

export const IconSearch: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></Icon>;
export const IconSortAscending: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></Icon>;
export const IconSortDescending: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></Icon>;
export const IconFile: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></Icon>;
export const IconDownload: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></Icon>;
export const IconShare: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.862 12.525 9.526 12 10.418 12h3.164c.892 0 1.556.525 1.734 1.342m-5.234-4.684a3 3 0 10-4.386-4.386 3 3 0 004.386 4.386zM19.316 21a3 3 0 10-4.386-4.386 3 3 0 004.386 4.386zM13.582 7.5a3 3 0 10-4.386-4.386 3 3 0 004.386 4.386z" /></Icon>;
export const IconGrid: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></Icon>;
export const IconList: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></Icon>;
export const IconFilter: React.FC<any> = (props) => <Icon {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L12 14.414V19a1 1 0 01-1.447.894l-4-2A1 1 0 016 17v-2.586L3.293 6.707A1 1 0 013 6V4z" /></Icon>;

export default Icon;
