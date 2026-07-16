export default ({ color }: { color: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="651.8127"
        height="551.31041"
        viewBox="0 0 651.8127 551.31041"
        className={'m-auto h-96 w-96'}
    >
        {/* Puzzle piece base */}
        <path
            d="M421.5,275.7c0-16.5,13.4-29.9,29.9-29.9s29.9,13.4,29.9,29.9v39.9h39.9c16.5,0,29.9,13.4,29.9,29.9s-13.4,29.9-29.9,29.9h-39.9v39.9c0,16.5-13.4,29.9-29.9,29.9s-29.9-13.4-29.9-29.9v-39.9h-39.9c-16.5,0-29.9-13.4-29.9-29.9s13.4-29.9,29.9-29.9h39.9V275.7z"
            fill={color}
            opacity="0.3"
        />

        {/* Main puzzle piece */}
        <path
            d="M376.5,310.7c0-16.5,13.4-29.9,29.9-29.9s29.9,13.4,29.9,29.9v39.9h39.9c16.5,0,29.9,13.4,29.9,29.9s-13.4,29.9-29.9,29.9h-39.9v39.9c0,16.5-13.4,29.9-29.9,29.9s-29.9-13.4-29.9-29.9v-39.9h-39.9c-16.5,0-29.9-13.4-29.9-29.9s13.4-29.9,29.9-29.9h39.9V310.7z"
            fill={color}
            opacity="0.6"
        />

        {/* Top puzzle piece */}
        <path
            d="M331.5,345.7c0-16.5,13.4-29.9,29.9-29.9s29.9,13.4,29.9,29.9v39.9h39.9c16.5,0,29.9,13.4,29.9,29.9s-13.4,29.9-29.9,29.9h-39.9v39.9c0,16.5-13.4,29.9-29.9,29.9s-29.9-13.4-29.9-29.9v-39.9h-39.9c-16.5,0-29.9-13.4-29.9-29.9s13.4-29.9,29.9-29.9h39.9V345.7z"
            fill={color}
        />

        {/* Decorative circles */}
        <circle cx="520" cy="220" r="15" fill={color} opacity="0.2" />
        <circle cx="180" cy="380" r="20" fill={color} opacity="0.15" />
        <circle cx="580" cy="450" r="12" fill={color} opacity="0.25" />
        <circle cx="100" cy="280" r="8" fill={color} opacity="0.3" />

        {/* Decorative lines */}
        <line x1="550" y1="320" x2="600" y2="320" stroke={color} strokeWidth="2" opacity="0.2" />
        <line x1="50" y1="420" x2="120" y2="420" stroke={color} strokeWidth="2" opacity="0.2" />
        <line x1="480" y1="500" x2="520" y2="500" stroke={color} strokeWidth="2" opacity="0.15" />
    </svg>
);
