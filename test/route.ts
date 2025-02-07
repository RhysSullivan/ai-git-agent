export function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    return Response.json({
        message: `Hello, ${team}!`
    });
}
