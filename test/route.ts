export function GET(request: Request) {
    const { searchParams } = new URL(request.url);


    const SUPER_SECRET_KEY = process.env.SUPER_SECRET_KEY;
    return Response.json({
        message: `Hello!`
    });
}
